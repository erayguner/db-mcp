#!/bin/bash
set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SRC_DIR="$PROJECT_ROOT/src"
BACKUP_DIR="$PROJECT_ROOT/.deployment-backups"
LOG_FILE="$PROJECT_ROOT/deployment.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Files
ORIGINAL_FILE="$SRC_DIR/index.ts"
REFACTORED_FILE="$SRC_DIR/index-refactored.ts"
BACKUP_FILE="$BACKUP_DIR/index.ts.$TIMESTAMP.backup"

# Flags
DRY_RUN=false
SKIP_TESTS=false
VERBOSE=false

# Logging function
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Print colored message
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
    log "INFO" "$message"
}

# Print error and exit
error_exit() {
    print_message "$RED" "ERROR: $1"
    log "ERROR" "$1"
    exit 1
}

# Print usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy refactored MCP server implementation.

OPTIONS:
    -d, --dry-run       Perform dry run without making changes
    -s, --skip-tests    Skip running tests
    -v, --verbose       Enable verbose output
    -h, --help          Show this help message

EXAMPLES:
    $0                  # Normal deployment
    $0 --dry-run        # Test deployment without changes
    $0 --skip-tests     # Deploy without running tests (not recommended)

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -s|--skip-tests)
                SKIP_TESTS=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                error_exit "Unknown option: $1"
                ;;
        esac
    done
}

# Check prerequisites
check_prerequisites() {
    print_message "$BLUE" "Checking prerequisites..."

    # Check if in project root
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        error_exit "Not in project root directory"
    fi

    # Check if refactored file exists
    if [[ ! -f "$REFACTORED_FILE" ]]; then
        error_exit "Refactored file not found: $REFACTORED_FILE"
    fi

    # Check if original file exists
    if [[ ! -f "$ORIGINAL_FILE" ]]; then
        error_exit "Original file not found: $ORIGINAL_FILE"
    fi

    # Check if node_modules exists
    if [[ ! -d "$PROJECT_ROOT/node_modules" ]]; then
        print_message "$YELLOW" "node_modules not found. Running npm install..."
        npm install || error_exit "npm install failed"
    fi

    print_message "$GREEN" "Prerequisites check passed"
}

# Create backup
create_backup() {
    print_message "$BLUE" "Creating backup..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would backup: $ORIGINAL_FILE -> $BACKUP_FILE"
        return 0
    fi

    # Create backup directory
    mkdir -p "$BACKUP_DIR"

    # Backup original file
    cp "$ORIGINAL_FILE" "$BACKUP_FILE" || error_exit "Failed to create backup"

    # Verify backup
    if [[ ! -f "$BACKUP_FILE" ]]; then
        error_exit "Backup file was not created"
    fi

    print_message "$GREEN" "Backup created: $BACKUP_FILE"
}

# Validate refactored file
validate_refactored_file() {
    print_message "$BLUE" "Validating refactored file..."

    # Check file is not empty
    if [[ ! -s "$REFACTORED_FILE" ]]; then
        error_exit "Refactored file is empty"
    fi

    # Check TypeScript syntax (basic check)
    if ! grep -q "export" "$REFACTORED_FILE"; then
        print_message "$YELLOW" "Warning: No exports found in refactored file"
    fi

    print_message "$GREEN" "Refactored file validation passed"
}

# Deploy refactored file
deploy_file() {
    print_message "$BLUE" "Deploying refactored implementation..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would copy: $REFACTORED_FILE -> $ORIGINAL_FILE"
        return 0
    fi

    # Copy refactored file to original location
    cp "$REFACTORED_FILE" "$ORIGINAL_FILE" || error_exit "Failed to deploy refactored file"

    print_message "$GREEN" "Refactored file deployed successfully"
}

# Build project
build_project() {
    print_message "$BLUE" "Building project..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would run: npm run build"
        return 0
    fi

    cd "$PROJECT_ROOT"

    if [[ "$VERBOSE" == true ]]; then
        npm run build || error_exit "Build failed"
    else
        npm run build > /dev/null 2>&1 || error_exit "Build failed. Run with --verbose for details"
    fi

    print_message "$GREEN" "Build completed successfully"
}

# Run tests
run_tests() {
    if [[ "$SKIP_TESTS" == true ]]; then
        print_message "$YELLOW" "Skipping tests (--skip-tests flag)"
        return 0
    fi

    print_message "$BLUE" "Running tests..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would run: npm test"
        return 0
    fi

    cd "$PROJECT_ROOT"

    if [[ "$VERBOSE" == true ]]; then
        npm test || error_exit "Tests failed"
    else
        npm test > /dev/null 2>&1 || error_exit "Tests failed. Run with --verbose for details"
    fi

    print_message "$GREEN" "All tests passed"
}

# Validate deployment
validate_deployment() {
    print_message "$BLUE" "Validating deployment..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would validate deployment"
        return 0
    fi

    # Check if build artifacts exist
    if [[ ! -d "$PROJECT_ROOT/dist" ]]; then
        error_exit "Build artifacts not found in dist/"
    fi

    # Check if main build file exists
    if [[ ! -f "$PROJECT_ROOT/dist/index.js" ]]; then
        error_exit "Main build file not found: dist/index.js"
    fi

    # Run validation script if it exists
    if [[ -f "$SCRIPT_DIR/validate-mcp.sh" ]]; then
        bash "$SCRIPT_DIR/validate-mcp.sh" || error_exit "Validation script failed"
    fi

    print_message "$GREEN" "Deployment validation passed"
}

# Cleanup old backups (keep last 10)
cleanup_backups() {
    print_message "$BLUE" "Cleaning up old backups..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would cleanup old backups"
        return 0
    fi

    if [[ -d "$BACKUP_DIR" ]]; then
        # Keep only the 10 most recent backups
        ls -t "$BACKUP_DIR"/index.ts.*.backup 2>/dev/null | tail -n +11 | xargs -r rm -f
        local remaining=$(ls "$BACKUP_DIR"/index.ts.*.backup 2>/dev/null | wc -l)
        print_message "$GREEN" "Backup cleanup complete ($remaining backups retained)"
    fi
}

# Print summary
print_summary() {
    print_message "$GREEN" "
╔════════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT SUCCESSFUL                       ║
╚════════════════════════════════════════════════════════════════╝

Deployment Details:
  • Timestamp:        $TIMESTAMP
  • Backup Location:  $BACKUP_FILE
  • Log File:         $LOG_FILE
  • Dry Run:          $DRY_RUN
  • Tests Skipped:    $SKIP_TESTS

Next Steps:
  1. Monitor application logs for any issues
  2. Run: npm start (to start the MCP server)
  3. Test the server with: npx @modelcontextprotocol/inspector

Rollback:
  If issues occur, run: $SCRIPT_DIR/rollback-mcp.sh $TIMESTAMP
"
}

# Main deployment flow
main() {
    print_message "$BLUE" "
╔════════════════════════════════════════════════════════════════╗
║         Database MCP Server - Deployment Script v1.0          ║
╚════════════════════════════════════════════════════════════════╝
"

    log "INFO" "Starting deployment process"

    # Parse arguments
    parse_args "$@"

    # Execute deployment steps
    check_prerequisites
    validate_refactored_file
    create_backup
    deploy_file
    build_project
    run_tests
    validate_deployment
    cleanup_backups

    # Print summary
    print_summary

    log "INFO" "Deployment completed successfully"
    exit 0
}

# Run main function
main "$@"
