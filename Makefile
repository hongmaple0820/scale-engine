.PHONY: help preflight preflight-ci new-task plan explore checkpoint gate gate-workflow gate-quality gate-fast-lane resume status lint-scaffold verify verify-list verify-docs-health validate bootstrap-scale bootstrap-scale-install bootstrap-scale-latest workflow-upgrade-check workflow-upgrade-plan workflow-upgrade-apply workflow-upgrade-rollback workflow-upgrade-verify workflow-aios-adopt setup-smoke scale-version scale-mode scale-context scale-codegraph scale-eval scale-radar scale-dashboard scale-smoke

SCALE ?= scale
SCALE_SMOKE ?= node --import tsx src/api/cli.ts
POWERSHELL ?= $(shell command -v pwsh 2>/dev/null || command -v powershell 2>/dev/null || echo pwsh)
SCALE_VERSION ?= locked
TASK ?= scale-engine workflow adaptation
FILES ?= AGENTS.md,CLAUDE.md,README.md
LEVEL ?= M
PHASE ?= plan
SERVICES ?=
BUDGET ?= 2400

help:
	@echo "make preflight | make new-task NAME=x LEVEL=M | make explore FILES='...' MSG='...'"
	@echo "make plan NAME=x LEVEL=M | make gate-workflow | make gate-quality | make gate-fast-lane | make verify PROFILE=default"
	@echo "make bootstrap-scale | make workflow-upgrade-check | make workflow-upgrade-plan | make workflow-aios-adopt"
	@echo "make preflight-ci | make setup-smoke | make scale-smoke"

gate:
	bash scripts/gates/all.sh --all

gate-workflow:
	bash scripts/gates/all.sh --workflow

gate-quality:
	bash scripts/gates/all.sh --quality

gate-fast-lane:
	bash scripts/gates/all.sh --fast-lane

new-task:
	@if [ -z "$(NAME)" ]; then echo "usage: make new-task NAME=x LEVEL=M"; exit 1; fi
	bash scripts/workflow/new-task.sh "$(NAME)" "$(or $(LEVEL),M)"

plan:
	@if [ -z "$(NAME)" ]; then echo "usage: make plan NAME=x LEVEL=M"; exit 1; fi
	bash scripts/workflow/plan.sh "$(NAME)" "$(or $(LEVEL),M)"

explore:
	@if [ -z "$(FILES)" ]; then echo "usage: make explore FILES='file1 file2' MSG='main contradiction'"; exit 1; fi
	bash scripts/workflow/explore.sh $(FILES) "$(MSG)"

checkpoint:
	bash scripts/workflow/checkpoint.sh "$(or $(PHASE),execute)"

resume:
	bash scripts/workflow/resume.sh

status: resume

lint-scaffold:
	bash scripts/workflow/lint-scaffold.sh

verify:
	bash scripts/workflow/verify.sh --profile "$(or $(PROFILE),default)"

verify-list:
	bash scripts/workflow/verify.sh --list

verify-docs-health:
	node scripts/workflow/docs-health.mjs

validate:
	bash scripts/validate-config.sh

preflight:
	bash scripts/preflight/all.sh

preflight-ci:
	$(SCALE) preflight --dir . --service all --profile ci --preflight-profile ci

bootstrap-scale:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version "$(or $(SCALE_VERSION),locked)"

bootstrap-scale-install:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version "$(or $(SCALE_VERSION),locked)" -AutoInstall

bootstrap-scale-latest:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/bootstrap-scale.ps1 -Version latest -AutoInstall

workflow-upgrade-check:
	$(SCALE) upgrade check --dir .

workflow-upgrade-plan:
	$(SCALE) upgrade plan --dir . --html

workflow-upgrade-apply:
	$(SCALE) upgrade apply --dir . --confirm

workflow-upgrade-rollback:
	$(SCALE) upgrade rollback --dir .

workflow-upgrade-verify:
	$(SCALE) preflight --dir . --service all --preflight-profile quick

workflow-aios-adopt:
	$(SCALE) ai-os adopt --dir . --task "$(TASK)" --files "$(FILES)" --level "$(LEVEL)" --budget "$(BUDGET)" --lang zh

setup-smoke:
	node scripts/workflow/setup-smoke.mjs --scale-command "$(SCALE_SMOKE)"

scale-version:
	$(SCALE) --version

scale-mode:
	$(SCALE) governance mode --task "$(TASK)" --files "$(FILES)"

scale-context:
	$(SCALE) context budget --dir .

scale-codegraph:
	$(SCALE) codegraph status --dir .

scale-eval:
	$(SCALE) eval run --dir .

scale-radar:
	$(SCALE) skill radar --dir . --task "$(TASK)" --phase "$(PHASE)" --level "$(LEVEL)" --files "$(FILES)" --services "$(SERVICES)"

scale-dashboard:
	$(SCALE) artifact dashboard --dir . --lang zh

scale-smoke:
	$(POWERSHELL) -NoProfile -ExecutionPolicy Bypass -File scripts/workflow/scale-smoke.ps1 -Task "$(TASK)" -Files "$(FILES)" -Level "$(LEVEL)" -Phase "$(PHASE)" -Services "$(SERVICES)"
