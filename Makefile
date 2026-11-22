SHELL := /bin/bash

RUN_ID ?= lokal
GITHUB_REPO ?= specrun-lab/levelboard-$(RUN_ID)
LIVE_DOMAIN ?=
LIVE_URL ?= https://$(RUN_ID).$(LIVE_DOMAIN)
URL ?= http://127.0.0.1:8080
API_URL ?= http://127.0.0.1:8081

.PHONY: all down level1 level2 level3 level4 level5 level6 level7 level8 level9 level10 \
	check build-frontend build-backend start-nginx-file start-nginx-api fresh-db start-backend \
	stop-backend restart-backend start-frontend

define wait_url
	@for i in $$(seq 1 120); do if curl -fs -o /dev/null "$(1)"; then exit 0; fi; sleep 0.5; done; \
	echo "Zeitüberschreitung: $(1) antwortet nicht"; \
	for log in .run/frontend.log .run/backend.log .run/nginx-error.log; do \
		if [ -f "$$log" ]; then echo "--- $$log"; tail -n 40 "$$log"; fi; \
	done; exit 1
endef

down:
	@for name in frontend nginx backend; do \
		if [ -f ".run/$$name.pid" ]; then \
			pid=$$(cat ".run/$$name.pid" 2>/dev/null || true); \
			if [ -n "$$pid" ] && kill -0 "$$pid" 2>/dev/null; then \
				kill "$$pid" 2>/dev/null || true; \
				for i in $$(seq 1 10); do kill -0 "$$pid" 2>/dev/null || break; sleep 0.5; done; \
				kill -9 "$$pid" 2>/dev/null || true; \
			fi; \
			rm -f ".run/$$name.pid"; \
		fi; \
	done
	@rm -f .run/level

build-frontend:
	@cd frontend && npm ci && npm run build

build-backend:
	@cd backend && go build -o bin/levelboard-backend .

start-frontend:
	@mkdir -p .run
	@cd frontend && { nohup ./node_modules/.bin/vite preview > ../.run/frontend.log 2>&1 < /dev/null & echo $$! > ../.run/frontend.pid; }

start-nginx-file:
	@mkdir -p .run/nginx-tmp
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx.conf

start-nginx-api:
	@mkdir -p .run/nginx-tmp
	@nginx -p "$(CURDIR)/" -e .run/nginx-error.log -c frontend/nginx-api.conf

fresh-db:
	@rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm

start-backend:
	@mkdir -p .run
	@cd backend && { LEVELBOARD_DB="$(CURDIR)/.run/levelboard.db" LEVELBOARD_ADDR=127.0.0.1:8081 nohup ./bin/levelboard-backend >> "$(CURDIR)/.run/backend.log" 2>&1 < /dev/null & echo $$! > "$(CURDIR)/.run/backend.pid"; }

stop-backend:
	@if [ -f .run/backend.pid ]; then \
		pid=$$(cat .run/backend.pid 2>/dev/null || true); \
		if [ -n "$$pid" ] && kill -0 "$$pid" 2>/dev/null; then \
			kill "$$pid" 2>/dev/null || true; \
			for i in $$(seq 1 10); do kill -0 "$$pid" 2>/dev/null || break; sleep 0.5; done; \
			kill -9 "$$pid" 2>/dev/null || true; \
		fi; \
		rm -f .run/backend.pid; \
	fi

restart-backend: stop-backend start-backend
	$(call wait_url,$(API_URL)/api/health)
	@echo "Backend neu gestartet (Datenbank erhalten)"

level1: down build-frontend start-frontend
	@echo 1 > .run/level
	$(call wait_url,http://127.0.0.1:8080/)
	@echo "Levelboard läuft auf http://127.0.0.1:8080"

level2: down build-frontend start-nginx-file
	@echo 2 > .run/level
	$(call wait_url,http://127.0.0.1:8080/)
	@echo "Levelboard läuft auf http://127.0.0.1:8080"

level3: down build-frontend start-nginx-file build-backend fresh-db start-backend
	@echo 3 > .run/level
	$(call wait_url,http://127.0.0.1:8080/)
	$(call wait_url,$(API_URL)/api/health)
	@echo "Levelboard läuft auf http://127.0.0.1:8080"
	@echo "Backend läuft auf http://127.0.0.1:8081"

level4: down build-frontend start-nginx-file build-backend fresh-db start-backend
	@echo 4 > .run/level
	$(call wait_url,http://127.0.0.1:8080/)
	$(call wait_url,$(API_URL)/api/health)
	@echo "Levelboard läuft auf http://127.0.0.1:8080"
	@echo "Backend läuft auf http://127.0.0.1:8081"
	@echo "Datenbank: .run/levelboard.db"

level5: down build-frontend build-backend fresh-db start-nginx-api start-backend
	@printf '{"source":"api"}' > frontend/dist/config.json
	@echo 5 > .run/level
	$(call wait_url,http://127.0.0.1:8080/api/health)
	$(call wait_url,http://127.0.0.1:8080/)
	@echo "Levelboard läuft auf http://127.0.0.1:8080 (Quelle: Backend)"
	@echo "Backend läuft auf http://127.0.0.1:8081"
	@echo "Datenbank: .run/levelboard.db"

level6: level5
	@echo 6 > .run/level
	@echo "Repo: https://github.com/$(GITHUB_REPO)"

level7: level6
	@echo 7 > .run/level
	@echo "Images: ghcr.io/$(GITHUB_REPO)-frontend und ghcr.io/$(GITHUB_REPO)-backend"

level8: level7
	@echo 8 > .run/level
	@echo "Live: $(LIVE_URL)"

level9: level8
	@echo 9 > .run/level
	@echo "Live-Prüfung gegen $(LIVE_URL)"

level10: level9
	@echo 10 > .run/level
	@echo "Abschlussbericht: $(LIVE_URL)"

check:
	@N=$$(cat .run/level 2>/dev/null || echo 10); \
	if [ ! -d checks/node_modules ]; then (cd checks && npm ci) || exit 1; fi; \
	(cd checks && npx playwright install chromium) || exit 1; \
	rm -f checks/.out/loadtest.json
	@N=$$(cat .run/level 2>/dev/null || echo 10); \
	FILES=""; for i in $$(seq 1 $$N); do FILES="$$FILES tests/level$$i.spec.ts"; done; \
	set +e; \
	(cd checks && BASE_URL="$(URL)" API_URL="$(API_URL)" GITHUB_REPO="$(GITHUB_REPO)" RUN_ID="$(RUN_ID)" LIVE_URL="$(LIVE_URL)" npx playwright test $$FILES); \
	TEST_EXIT=$$?; \
	WRITE_ENV="GITHUB_REPO=$(GITHUB_REPO) RUN_ID=$(RUN_ID)"; \
	if [ $$N -ge 5 ]; then WRITE_ENV="$$WRITE_ENV REPORT_API=1 API_URL=$(API_URL)"; fi; \
	if [ $$N -ge 9 ]; then WRITE_ENV="$$WRITE_ENV REPORT_LIVE=1 LIVE_URL=$(LIVE_URL)"; fi; \
	(cd checks && env $$WRITE_ENV node write-results.mjs $$(seq -s ' ' 1 $$N)); \
	WRITE_EXIT=$$?; \
	LIVE_EXIT=0; \
	if [ $$N -ge 10 ] && [ $$WRITE_EXIT -eq 0 ]; then \
		(cd checks && LIVE_URL="$(LIVE_URL)" RUN_ID="$(RUN_ID)" npx playwright test tests/live-report.spec.ts --reporter=list); \
		LIVE_EXIT=$$?; \
	fi; \
	if [ $$TEST_EXIT -ne 0 ] || [ $$WRITE_EXIT -ne 0 ] || [ $$LIVE_EXIT -ne 0 ]; then exit 1; fi
