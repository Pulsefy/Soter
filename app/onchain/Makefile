.PHONY: all build test fmt clippy clean deploy help

all: test build

build:
	@echo "🚀 Building contracts..."
	@./scripts/build.sh --optimize

test:
	@echo "🧪 Running tests..."
	@cargo test -- --nocapture

fmt:
	@echo "🎨 Formatting code..."
	@cargo fmt --all

clippy:
	@echo "🔍 Linting code..."
	@cargo clippy -- -D warnings

clean:
	@echo "🧹 Cleaning build artifacts..."
	@cargo clean
	@rm -rf target/

deploy:
	@echo "📡 Deploying contract..."
	@./scripts/deploy.sh

invoke:
	@echo "🔧 Interactive invocation..."
	@echo "Usage: make invoke FUNCTION=create_package ARGS=\"recipient 1000 token\""
ifdef FUNCTION
	@./scripts/invoke.sh $(FUNCTION) $(ARGS)
else
	@./scripts/invoke.sh
endif

initialize:
	@echo "🔧 Initializing contract..."
	@./scripts/initialize.sh --contract $(CONTRACT_ID) --admin $(ADMIN)

create-package:
	@echo "📦 Creating package..."
	@./scripts/create_package.sh --contract $(CONTRACT_ID) --operator $(OPERATOR) \
		--id $(PKG_ID) --recipient $(RECIPIENT) --amount $(AMOUNT) --token $(TOKEN) \
		--expires-at $(EXPIRES_AT)

claim:
	@echo "🎁 Claiming package..."
	@./scripts/claim.sh --contract $(CONTRACT_ID) --id $(PKG_ID)

query:
	@echo "🔍 Querying contract..."
	@./scripts/query.sh --contract $(CONTRACT_ID) --action $(ACTION) \
		--id $(PKG_ID) --token $(TOKEN)

audit:
	@echo "🔒 Auditing dependencies..."
	@cargo audit

docs:
	@echo "📚 Generating documentation..."
	@cargo doc --open

help:
	@echo "Available targets:"
	@echo "  build     - Build and optimize contracts"
	@echo "  test      - Run all tests with output"
	@echo "  fmt       - Format all code"
	@echo "  clippy    - Lint code"
	@echo "  clean     - Clean build artifacts"
	@echo "  deploy    - Deploy contract to configured network"
	@echo "  invoke    - Invoke contract function (set FUNCTION and ARGS)"
	@echo "  audit     - Security audit of dependencies"
	@echo "  docs      - Generate and open documentation"
	@echo ""
	@echo "Examples:"
	@echo "  make build"
	@echo "  make deploy"
	@echo "  make invoke FUNCTION=create_package ARGS=\"GB... 1000 USD...\""