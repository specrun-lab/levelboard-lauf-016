package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func newTestServer(t *testing.T) (*Store, *httptest.Server) {
	t.Helper()
	t.Setenv("RUN_ID", "")
	t.Setenv("LEVELBOARD_COMMIT", "")
	store, err := OpenStore(filepath.Join(t.TempDir(), "levelboard.db"))
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(store))
	t.Cleanup(func() {
		server.Close()
		store.Close()
	})
	return store, server
}

func request(t *testing.T, method, url, contentType string, body io.Reader) (*http.Response, []byte) {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("Content-Type = %q", response.Header.Get("Content-Type"))
	}
	return response, raw
}

func postResult(t *testing.T, base string, level int, checks []Check, duration int64, metrics string) (*http.Response, []byte) {
	t.Helper()
	payload := map[string]any{"checks": checks, "durationMs": duration}
	if metrics != "" {
		payload["metrics"] = json.RawMessage(metrics)
	}
	body, _ := json.Marshal(payload)
	return request(t, http.MethodPost, base+"/api/levels/"+itoa(level)+"/result", "application/json", bytes.NewReader(body))
}

func itoa(value int) string {
	return strconv.Itoa(value)
}

func TestHealthAndInitialResults(t *testing.T) {
	_, server := newTestServer(t)
	response, body := request(t, http.MethodGet, server.URL+"/api/health", "", nil)
	if response.StatusCode != 200 {
		t.Fatalf("Status = %d", response.StatusCode)
	}
	var health map[string]any
	if err := json.Unmarshal(body, &health); err != nil {
		t.Fatal(err)
	}
	if health["status"] != "ok" || health["commit"] != nil {
		t.Fatalf("Health = %v", health)
	}
	response, body = request(t, http.MethodGet, server.URL+"/api/levels", "", nil)
	if response.StatusCode != 200 {
		t.Fatalf("Status = %d", response.StatusCode)
	}
	var results Results
	if err := json.Unmarshal(body, &results); err != nil {
		t.Fatal(err)
	}
	if results.Run.ID != "lokal" || results.Run.Version != version || results.Run.Commit != nil || results.Run.UpdatedAt != nil {
		t.Fatalf("Run = %+v", results.Run)
	}
	if len(results.Levels) != 10 {
		t.Fatalf("Levels = %d", len(results.Levels))
	}
	for _, level := range results.Levels {
		if level.Status != "offen" || level.CheckedAt != nil || level.DurationMs != nil {
			t.Fatalf("Level %d = %+v", level.Level, level)
		}
	}
}

func TestReportFlowAndConflict(t *testing.T) {
	_, server := newTestServer(t)
	response, _ := postResult(t, server.URL, 1, []Check{{Name: "ok", OK: true}}, 10, "")
	if response.StatusCode != 200 {
		t.Fatalf("Status = %d", response.StatusCode)
	}
	var results Results
	_, body := request(t, http.MethodGet, server.URL+"/api/levels", "", nil)
	json.Unmarshal(body, &results)
	if results.Levels[0].Status != "bestanden" || results.Levels[1].Status != "offen" || results.Run.UpdatedAt == nil {
		t.Fatalf("Results = %+v", results)
	}
	response, _ = postResult(t, server.URL, 2, []Check{{Name: "fehler", OK: false}}, 5, "")
	if response.StatusCode != 200 {
		t.Fatalf("Status = %d", response.StatusCode)
	}
	_, body = request(t, http.MethodGet, server.URL+"/api/levels", "", nil)
	json.Unmarshal(body, &results)
	if results.Levels[1].Status != "fehlgeschlagen" {
		t.Fatalf("Level 2 = %+v", results.Levels[1])
	}
	for _, level := range results.Levels[2:] {
		if level.Status != "gesperrt" {
			t.Fatalf("Level %d = %s", level.Level, level.Status)
		}
	}
	response, _ = postResult(t, server.URL, 3, []Check{{Name: "ok", OK: true}}, 5, "")
	if response.StatusCode != 409 {
		t.Fatalf("Status = %d", response.StatusCode)
	}
}

func TestHistoryOrderAndLimit(t *testing.T) {
	_, server := newTestServer(t)
	postResult(t, server.URL, 1, []Check{{Name: "a", OK: true}}, 101, "")
	postResult(t, server.URL, 1, []Check{{Name: "b", OK: true}}, 102, `{"x":1}`)
	_, body := request(t, http.MethodGet, server.URL+"/api/levels/1/history", "", nil)
	var history History
	json.Unmarshal(body, &history)
	if len(history.Entries) != 2 || history.Entries[0].DurationMs != 102 || history.Entries[1].DurationMs != 101 {
		t.Fatalf("History = %+v", history)
	}
	if history.Entries[0].ID <= history.Entries[1].ID {
		t.Fatalf("IDs = %+v", history.Entries)
	}
	_, body = request(t, http.MethodGet, server.URL+"/api/levels/1/history?limit=1", "", nil)
	json.Unmarshal(body, &history)
	if len(history.Entries) != 1 {
		t.Fatalf("Limit = %+v", history)
	}
	for _, limit := range []string{"0", "501", "abc", ""} {
		response, _ := request(t, http.MethodGet, server.URL+"/api/levels/1/history?limit="+limit, "", nil)
		if response.StatusCode != 400 {
			t.Fatalf("limit=%q Status = %d", limit, response.StatusCode)
		}
	}
}

func TestValidation(t *testing.T) {
	_, server := newTestServer(t)
	cases := []string{
		`{kaputt`,
		`{}`,
		`{"checks":[],"durationMs":1}`,
		`{"checks":null,"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1.5}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":-1}`,
		`{"checks":[{"name":"","ok":true}],"durationMs":1}`,
		`{"checks":[{"name":"a"}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true,"extra":1}],"durationMs":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"extra":1}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1,"metrics":[]}`,
		`[]`,
	}
	for _, payload := range cases {
		response, body := request(t, http.MethodPost, server.URL+"/api/levels/1/result", "application/json", strings.NewReader(payload))
		if response.StatusCode != 400 {
			t.Fatalf("%s: Status = %d (%s)", payload, response.StatusCode, body)
		}
	}
	response, _ := request(t, http.MethodPost, server.URL+"/api/levels/1/result", "text/plain", strings.NewReader(`{}`))
	if response.StatusCode != 415 {
		t.Fatalf("415: %d", response.StatusCode)
	}
	big := `{"checks":[{"name":"` + strings.Repeat("x", 70000) + `","ok":true}],"durationMs":1}`
	response, _ = request(t, http.MethodPost, server.URL+"/api/levels/1/result", "application/json", strings.NewReader(big))
	if response.StatusCode != 413 {
		t.Fatalf("413: %d", response.StatusCode)
	}
	response, _ = request(t, http.MethodDelete, server.URL+"/api/levels", "", nil)
	if response.StatusCode != 405 || response.Header.Get("Allow") != "GET" {
		t.Fatalf("405: %d Allow=%q", response.StatusCode, response.Header.Get("Allow"))
	}
	for _, path := range []string{"/api/levels/0", "/api/levels/11", "/api/levels/abc", "/unbekannt"} {
		response, _ := request(t, http.MethodGet, server.URL+path, "", nil)
		if response.StatusCode != 404 {
			t.Fatalf("%s: %d", path, response.StatusCode)
		}
	}
}

func TestPersistenceAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "levelboard.db")
	store, err := OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(NewServer(store))
	postResult(t, server.URL, 1, []Check{{Name: "a", OK: true}}, 42, "")
	server.Close()
	store.Close()

	store, err = OpenStore(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	results, err := store.Results()
	if err != nil {
		t.Fatal(err)
	}
	if results.Levels[0].Status != "bestanden" || results.Levels[0].DurationMs == nil || *results.Levels[0].DurationMs != 42 {
		t.Fatalf("Level 1 = %+v", results.Levels[0])
	}
	history, err := store.History(1, 500)
	if err != nil || len(history.Entries) != 1 {
		t.Fatalf("History = %+v err=%v", history, err)
	}
}

func TestUsage(t *testing.T) {
	store, server := newTestServer(t)
	_, body := request(t, http.MethodGet, server.URL+"/api/usage", "", nil)
	if string(body) != "{}" {
		t.Fatalf("GET = %s", body)
	}
	payload := `{"harness":"test","total":{"output":1,"total":2,"costUsd":null}}`
	response, body := request(t, http.MethodPut, server.URL+"/api/usage", "application/json", strings.NewReader(payload))
	if response.StatusCode != 200 || !strings.Contains(string(body), `"harness":"test"`) {
		t.Fatalf("PUT = %d %s", response.StatusCode, body)
	}
	_, body = request(t, http.MethodGet, server.URL+"/api/usage", "", nil)
	if !strings.Contains(string(body), `"harness":"test"`) {
		t.Fatalf("GET = %s", body)
	}
	for _, invalid := range []string{`[1,2]`, `1`, `null`, `{kaputt`} {
		response, _ := request(t, http.MethodPut, server.URL+"/api/usage", "application/json", strings.NewReader(invalid))
		if response.StatusCode != 400 {
			t.Fatalf("%s: %d", invalid, response.StatusCode)
		}
	}
	response, _ = request(t, http.MethodPut, server.URL+"/api/usage", "text/plain", strings.NewReader(`{}`))
	if response.StatusCode != 415 {
		t.Fatalf("415: %d", response.StatusCode)
	}
	response, _ = request(t, http.MethodPost, server.URL+"/api/usage", "application/json", strings.NewReader(`{}`))
	if response.StatusCode != 405 || !strings.Contains(response.Header.Get("Allow"), "PUT") {
		t.Fatalf("405: %d %q", response.StatusCode, response.Header.Get("Allow"))
	}
	response, _ = request(t, http.MethodPut, server.URL+"/api/usage", "application/json", strings.NewReader(`{}`))
	if response.StatusCode != 200 {
		t.Fatalf("PUT {}: %d", response.StatusCode)
	}
	usage := store.Usage()
	if string(usage) != "{}" {
		t.Fatalf("store usage = %s", usage)
	}
}

func TestDatabaseSchema(t *testing.T) {
	store, _ := newTestServer(t)
	var userVersion int
	if err := store.db.QueryRow("PRAGMA user_version").Scan(&userVersion); err != nil || userVersion != 1 {
		t.Fatalf("user_version = %d err=%v", userVersion, err)
	}
	expected := map[string][]string{
		"levels":  {"level", "status", "checked_at", "duration_ms", "checks", "metrics"},
		"reports": {"id", "level", "status", "checked_at", "duration_ms", "checks", "metrics"},
		"meta":    {"key", "value"},
	}
	for table, columns := range expected {
		rows, err := store.db.Query("PRAGMA table_info(" + table + ")")
		if err != nil {
			t.Fatal(err)
		}
		var names []string
		for rows.Next() {
			var cid int
			var name, kind string
			var notNull, primary int
			var defaultValue any
			if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primary); err != nil {
				t.Fatal(err)
			}
			names = append(names, name)
		}
		rows.Close()
		if strings.Join(names, ",") != strings.Join(columns, ",") {
			t.Fatalf("%s = %v", table, names)
		}
	}
}
