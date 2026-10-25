.PHONY: help install dev build test typecheck lint run up down logs compose-config docker-build smoke clean

APP_DIR := app

help:
	@echo "Target:"
	@echo "  install        Install dependency app (npm)"
	@echo "  dev            Jalankan app lokal (hot reload) via tsx"
	@echo "  build          Compile TypeScript -> dist"
	@echo "  test           Jalankan unit & integration test"
	@echo "  typecheck      Typecheck (dipakai sebagai lint)"
	@echo "  up / down      Jalankan / hentikan stack Docker Compose"
	@echo "  logs           Tail log container"
	@echo "  compose-config docker compose config --quiet"
	@echo "  docker-build   Build image aplikasi"
	@echo "  smoke          Health check cepat (localhost:18080)"
	@echo "  clean          Hapus dist & node_modules"

install:
	cd $(APP_DIR) && (npm ci || npm install)

dev:
	cd $(APP_DIR) && CHALLENGE_DIR=$(CURDIR)/challenge AUTH_MODE=mock APP_ENV=development npm run dev

build:
	cd $(APP_DIR) && npm run build

test:
	cd $(APP_DIR) && npm test

typecheck lint:
	cd $(APP_DIR) && npm run typecheck

compose-config:
	docker compose config --quiet

docker-build:
	docker compose build phishing-trail

up:
	docker compose up -d --build

down:
	docker compose down

logs:
	docker compose logs -f phishing-trail

smoke:
	curl -fsS http://127.0.0.1:18080/healthz && echo "" && echo "OK"

clean:
	rm -rf $(APP_DIR)/dist $(APP_DIR)/node_modules
