package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var errConflict = errors.New("ein niedrigeres Level ist nicht bestanden")

var levelTitles = []string{
	"Statische Seite",
	"Webserver",
	"REST-Backend",
	"Datenbank",
	"Frontend + Backend",
	"Repo + CI",
	"Images in der Pipeline",
	"Deployment",
	"Live-Prüfung",
	"Metriken veröffentlicht",
}

const version = "0.1.0"

type Check struct {
	Name string `json:"name"`
	OK   bool   `json:"ok"`
}

type Level struct {
	Level      int             `json:"level"`
	Title      string          `json:"title"`
	Status     string          `json:"status"`
	CheckedAt  *string         `json:"checkedAt"`
	DurationMs *int64          `json:"durationMs"`
	Checks     []Check         `json:"checks"`
	Metrics    json.RawMessage `json:"metrics"`
}

type RunInfo struct {
	ID        string  `json:"id"`
	Version   string  `json:"version"`
	Commit    *string `json:"commit"`
	UpdatedAt *string `json:"updatedAt"`
}

type Results struct {
	Run    RunInfo `json:"run"`
	Levels []Level `json:"levels"`
}

type HistoryEntry struct {
	ID         int64           `json:"id"`
	Status     string          `json:"status"`
	CheckedAt  string          `json:"checkedAt"`
	DurationMs int64           `json:"durationMs"`
	Checks     []Check         `json:"checks"`
	Metrics    json.RawMessage `json:"metrics"`
}

type History struct {
	Level   int            `json:"level"`
	Entries []HistoryEntry `json:"entries"`
}

type Store struct {
	db        *sql.DB
	mu        sync.Mutex
	usageMu   sync.Mutex
	usagePath string
	usage     json.RawMessage
}

func commitValue() *string {
	value := os.Getenv("LEVELBOARD_COMMIT")
	if value == "" {
		return nil
	}
	return &value
}

func runID() string {
	value := os.Getenv("RUN_ID")
	if value == "" {
		return "lokal"
	}
	return value
}

func OpenStore(path string) (*Store, error) {
	if dir := filepath.Dir(path); dir != "" && dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, err
		}
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{
		db:        db,
		usagePath: filepath.Join(filepath.Dir(path), "usage.json"),
		usage:     json.RawMessage("{}"),
	}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	store.loadUsage()
	return store, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	var versionNumber int
	if err := s.db.QueryRow("PRAGMA user_version").Scan(&versionNumber); err != nil {
		return err
	}
	if versionNumber != 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	statements := []string{
		`CREATE TABLE levels (
  level        INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 10),
  status       TEXT    NOT NULL CHECK (status IN ('offen','bestanden','fehlgeschlagen','gesperrt')),
  checked_at   TEXT,
  duration_ms  INTEGER,
  checks       TEXT    NOT NULL DEFAULT '[]',
  metrics      TEXT    NOT NULL DEFAULT '{}'
)`,
		`CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        INTEGER NOT NULL REFERENCES levels(level),
  status       TEXT    NOT NULL CHECK (status IN ('bestanden','fehlgeschlagen')),
  checked_at   TEXT    NOT NULL,
  duration_ms  INTEGER NOT NULL,
  checks       TEXT    NOT NULL,
  metrics      TEXT    NOT NULL
)`,
		`CREATE INDEX reports_level ON reports(level, id)`,
		`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return err
		}
	}
	for level := 1; level <= 10; level++ {
		if _, err := tx.Exec(`INSERT INTO levels (level, status, checked_at, duration_ms, checks, metrics) VALUES (?, 'offen', NULL, NULL, '[]', '{}')`, level); err != nil {
			return err
		}
	}
	if _, err := tx.Exec("PRAGMA user_version = 1"); err != nil {
		return err
	}
	return tx.Commit()
}

func normalizeChecks(raw string) []Check {
	var checks []Check
	if err := json.Unmarshal([]byte(raw), &checks); err != nil || checks == nil {
		return []Check{}
	}
	return checks
}

func normalizeMetrics(raw string) json.RawMessage {
	if raw == "" {
		return json.RawMessage("{}")
	}
	var value map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &value); err != nil || value == nil {
		return json.RawMessage("{}")
	}
	return json.RawMessage(raw)
}

func (s *Store) updatedAt() (*string, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM meta WHERE key = 'updated_at'`).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func (s *Store) Results() (Results, error) {
	results := Results{
		Run: RunInfo{
			ID:      runID(),
			Version: version,
			Commit:  commitValue(),
		},
		Levels: make([]Level, 0, 10),
	}
	updated, err := s.updatedAt()
	if err != nil {
		return results, err
	}
	results.Run.UpdatedAt = updated
	rows, err := s.db.Query(`SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels ORDER BY level`)
	if err != nil {
		return results, err
	}
	defer rows.Close()
	for rows.Next() {
		var level Level
		var checkedAt sql.NullString
		var duration sql.NullInt64
		var checks, metrics string
		if err := rows.Scan(&level.Level, &level.Status, &checkedAt, &duration, &checks, &metrics); err != nil {
			return results, err
		}
		level.Title = levelTitles[level.Level-1]
		if checkedAt.Valid {
			value := checkedAt.String
			level.CheckedAt = &value
		}
		if duration.Valid {
			value := duration.Int64
			level.DurationMs = &value
		}
		level.Checks = normalizeChecks(checks)
		level.Metrics = normalizeMetrics(metrics)
		results.Levels = append(results.Levels, level)
	}
	return results, rows.Err()
}

func (s *Store) Report(levelNumber int, checks []Check, durationMs int64, metrics json.RawMessage) (Results, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	status := "bestanden"
	for _, check := range checks {
		if !check.OK {
			status = "fehlgeschlagen"
			break
		}
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	checksJSON, err := json.Marshal(checks)
	if err != nil {
		return Results{}, err
	}
	if len(metrics) == 0 {
		metrics = json.RawMessage("{}")
	}

	tx, err := s.db.Begin()
	if err != nil {
		return Results{}, err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`SELECT status FROM levels WHERE level < ? ORDER BY level`, levelNumber)
	if err != nil {
		return Results{}, err
	}
	lowerOK := true
	for rows.Next() {
		var lowerStatus string
		if err := rows.Scan(&lowerStatus); err != nil {
			rows.Close()
			return Results{}, err
		}
		if lowerStatus != "bestanden" {
			lowerOK = false
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return Results{}, err
	}
	rows.Close()
	if !lowerOK {
		return Results{}, errConflict
	}

	if _, err := tx.Exec(
		`UPDATE levels SET status = ?, checked_at = ?, duration_ms = ?, checks = ?, metrics = ? WHERE level = ?`,
		status, now, durationMs, string(checksJSON), string(metrics), levelNumber,
	); err != nil {
		return Results{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO reports (level, status, checked_at, duration_ms, checks, metrics) VALUES (?, ?, ?, ?, ?, ?)`,
		levelNumber, status, now, durationMs, string(checksJSON), string(metrics),
	); err != nil {
		return Results{}, err
	}
	higherStatus := "offen"
	if status != "bestanden" {
		higherStatus = "gesperrt"
	}
	if _, err := tx.Exec(
		`UPDATE levels SET status = ?, checked_at = NULL, duration_ms = NULL, checks = '[]', metrics = '{}' WHERE level > ?`,
		higherStatus, levelNumber,
	); err != nil {
		return Results{}, err
	}
	if _, err := tx.Exec(
		`INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
		now,
	); err != nil {
		return Results{}, err
	}
	if err := tx.Commit(); err != nil {
		return Results{}, err
	}
	return s.Results()
}

func (s *Store) History(levelNumber, limit int) (History, error) {
	history := History{Level: levelNumber, Entries: []HistoryEntry{}}
	rows, err := s.db.Query(
		`SELECT id, status, checked_at, duration_ms, checks, metrics FROM reports WHERE level = ? ORDER BY id DESC LIMIT ?`,
		levelNumber, limit,
	)
	if err != nil {
		return history, err
	}
	defer rows.Close()
	for rows.Next() {
		var entry HistoryEntry
		var checks, metrics string
		if err := rows.Scan(&entry.ID, &entry.Status, &entry.CheckedAt, &entry.DurationMs, &checks, &metrics); err != nil {
			return history, err
		}
		entry.Checks = normalizeChecks(checks)
		entry.Metrics = normalizeMetrics(metrics)
		history.Entries = append(history.Entries, entry)
	}
	return history, rows.Err()
}

func (s *Store) loadUsage() {
	raw, err := os.ReadFile(s.usagePath)
	if err != nil {
		s.usage = json.RawMessage("{}")
		return
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		s.usage = json.RawMessage("{}")
		return
	}
	s.usage = json.RawMessage(raw)
}

func (s *Store) Usage() json.RawMessage {
	s.usageMu.Lock()
	defer s.usageMu.Unlock()
	if len(s.usage) == 0 {
		return json.RawMessage("{}")
	}
	return s.usage
}

func (s *Store) SetUsage(raw json.RawMessage) error {
	s.usageMu.Lock()
	defer s.usageMu.Unlock()
	if len(raw) == 0 {
		raw = json.RawMessage("{}")
	}
	if err := os.MkdirAll(filepath.Dir(s.usagePath), 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(s.usagePath), "usage-*.tmp")
	if err != nil {
		return err
	}
	name := temp.Name()
	if _, err := temp.Write(raw); err != nil {
		temp.Close()
		os.Remove(name)
		return err
	}
	if err := temp.Close(); err != nil {
		os.Remove(name)
		return err
	}
	if err := os.Rename(name, s.usagePath); err != nil {
		os.Remove(name)
		return err
	}
	s.usage = append(json.RawMessage(nil), raw...)
	return nil
}
