# =============================================================================
# SurviveV1 — common tasks
#   make help      show all targets
#   make dev       run the dashboard locally with demo storage
# =============================================================================
.PHONY: help install deps test lint smoke unit check start stop status dev download

help:  ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[32m%-12s\033[0m %s\n", $$1, $$2}'

install:  ## Full system install (Raspberry Pi, requires sudo)
	sudo bash setup/install.sh

deps:  ## Install Python dependencies only (for development)
	pip install -r requirements.txt

lint:  ## Run pylint + shellcheck
	pylint web/server.py web/constants.py scripts/index_documents.py \
	  scripts/build_drug_index.py scripts/set_admin_password.py \
	  --disable=C0114,C0115,C0116,R0903,R0913,R0914,R0801 --fail-under=7.0
	@command -v shellcheck >/dev/null && \
	  shellcheck install/*.sh scripts/*.sh setup/*.sh download/*.sh || \
	  echo "shellcheck not installed — skipping shell lint"

smoke:  ## Run dashboard smoke tests
	bash tests/test_smoke.sh

unit:  ## Run Python unit tests
	python3 -m pytest tests/ -q

test: lint unit smoke  ## Run all checks (lint + unit + smoke)

check: test  ## Alias for test

start:  ## Start all services
	bash scripts/start_services.sh

stop:  ## Stop all services
	bash scripts/stop_services.sh

status:  ## Show service status
	bash scripts/status.sh

dev:  ## Run the dashboard locally on :8080 with demo storage in /tmp
	mkdir -p /tmp/survive_dev
	SURVIVE_STORAGE_PATH=/tmp/survive_dev PORT=8080 python3 web/server.py

download:  ## Download all enabled content categories
	bash download/download_all.sh
