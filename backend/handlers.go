package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"mime"
	"net/http"
	"strconv"
	"strings"
)

type Server struct {
	store *Store
}

func NewServer(store *Store) *Server {
	return &Server{store: store}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *statusRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		log.Printf("%s %s %d", r.Method, r.URL.RequestURI(), recorder.status)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	body, err := json.Marshal(value)
	if err != nil {
		body = []byte(`{"error":"interner Fehler"}`)
		status = http.StatusInternalServerError
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(body)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	switch {
	case path == "/api/health":
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"version": version,
			"commit":  commitValue(),
		})
		return
	case path == "/api/usage":
		s.handleUsage(w, r)
		return
	case path == "/api/levels":
		if r.Method != http.MethodGet {
			methodNotAllowed(w, "GET")
			return
		}
		results, err := s.store.Results()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Daten konnten nicht gelesen werden")
			return
		}
		writeJSON(w, http.StatusOK, results)
		return
	case strings.HasPrefix(path, "/api/levels/"):
		s.handleLevelPath(w, r)
		return
	default:
		writeError(w, http.StatusNotFound, "nicht gefunden")
	}
}

func (s *Server) handleLevelPath(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/levels/")
	parts := strings.Split(rest, "/")
	levelNumber, err := strconv.Atoi(parts[0])
	if err != nil || levelNumber < 1 || levelNumber > 10 {
		writeError(w, http.StatusNotFound, "unbekanntes Level")
		return
	}
	switch {
	case len(parts) == 1:
		s.handleLevel(w, r, levelNumber)
	case len(parts) == 2 && parts[1] == "result":
		s.handleResult(w, r, levelNumber)
	case len(parts) == 2 && parts[1] == "history":
		s.handleHistory(w, r, levelNumber)
	default:
		writeError(w, http.StatusNotFound, "nicht gefunden")
	}
}

func (s *Server) handleLevel(w http.ResponseWriter, r *http.Request, levelNumber int) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	results, err := s.store.Results()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Daten konnten nicht gelesen werden")
		return
	}
	for _, level := range results.Levels {
		if level.Level == levelNumber {
			writeJSON(w, http.StatusOK, level)
			return
		}
	}
	writeError(w, http.StatusNotFound, "unbekanntes Level")
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(value)
	return err == nil && strings.EqualFold(mediaType, "application/json")
}

func readLimitedBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if !isJSONContentType(r.Header.Get("Content-Type")) {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
		return nil, false
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Body konnte nicht gelesen werden")
		return nil, false
	}
	if len(body) > 65536 {
		writeError(w, http.StatusRequestEntityTooLarge, "Body ist größer als 64 KB")
		return nil, false
	}
	return body, true
}

type rawCheck struct {
	Name *string `json:"name"`
	OK   *bool   `json:"ok"`
}

type rawReport struct {
	Checks     *[]rawCheck     `json:"checks"`
	DurationMs *int64          `json:"durationMs"`
	Metrics    json.RawMessage `json:"metrics"`
}

func parseReport(body []byte) ([]Check, int64, json.RawMessage, bool) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	var raw rawReport
	if err := decoder.Decode(&raw); err != nil {
		return nil, 0, nil, false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, 0, nil, false
	}
	if raw.Checks == nil || len(*raw.Checks) < 1 || len(*raw.Checks) > 100 {
		return nil, 0, nil, false
	}
	checks := make([]Check, 0, len(*raw.Checks))
	for _, rawEntry := range *raw.Checks {
		if rawEntry.Name == nil || *rawEntry.Name == "" || rawEntry.OK == nil {
			return nil, 0, nil, false
		}
		checks = append(checks, Check{Name: *rawEntry.Name, OK: *rawEntry.OK})
	}
	if raw.DurationMs == nil || *raw.DurationMs < 0 {
		return nil, 0, nil, false
	}
	metrics := json.RawMessage("{}")
	if len(raw.Metrics) > 0 && !bytes.Equal(bytes.TrimSpace(raw.Metrics), []byte("null")) {
		var object map[string]json.RawMessage
		if err := json.Unmarshal(raw.Metrics, &object); err != nil || object == nil {
			return nil, 0, nil, false
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, raw.Metrics); err != nil {
			return nil, 0, nil, false
		}
		metrics = compact.Bytes()
	}
	return checks, *raw.DurationMs, metrics, true
}

func (s *Server) handleResult(w http.ResponseWriter, r *http.Request, levelNumber int) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	body, ok := readLimitedBody(w, r)
	if !ok {
		return
	}
	checks, durationMs, metrics, ok := parseReport(body)
	if !ok {
		writeError(w, http.StatusBadRequest, "ungültige Meldung")
		return
	}
	results, err := s.store.Report(levelNumber, checks, durationMs, metrics)
	if err != nil {
		if err == errConflict {
			writeError(w, http.StatusConflict, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "Meldung konnte nicht gespeichert werden")
		return
	}
	writeJSON(w, http.StatusOK, results)
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request, levelNumber int) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	limit := 50
	values, present := r.URL.Query()["limit"]
	if present {
		if len(values) == 0 {
			writeError(w, http.StatusBadRequest, "ungültiges limit")
			return
		}
		parsed, err := strconv.Atoi(values[0])
		if err != nil || parsed < 1 || parsed > 500 {
			writeError(w, http.StatusBadRequest, "ungültiges limit")
			return
		}
		limit = parsed
	}
	history, err := s.store.History(levelNumber, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Historie konnte nicht gelesen werden")
		return
	}
	writeJSON(w, http.StatusOK, history)
}

func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, s.store.Usage())
	case http.MethodPut:
		body, ok := readLimitedBody(w, r)
		if !ok {
			return
		}
		var object map[string]json.RawMessage
		if err := json.Unmarshal(body, &object); err != nil || object == nil {
			writeError(w, http.StatusBadRequest, "Verbrauch muss ein JSON-Objekt sein")
			return
		}
		var compact bytes.Buffer
		if err := json.Compact(&compact, body); err != nil {
			writeError(w, http.StatusBadRequest, "ungültiges JSON")
			return
		}
		if err := s.store.SetUsage(compact.Bytes()); err != nil {
			writeError(w, http.StatusInternalServerError, "Verbrauch konnte nicht gespeichert werden")
			return
		}
		writeJSON(w, http.StatusOK, s.store.Usage())
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}
