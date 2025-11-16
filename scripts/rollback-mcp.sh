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
LOG_FILE="$PROJECT_ROOT/rollback.log"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Files
ORIGINAL_FILE="$SRC_DIR/index.ts"

# Flags
DRY_RUN=false
VERBOSE=false
FORCE=false

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
Usage: $0 [OPTIONS] [TIMESTAMP]

Rollback to a previous version of the MCP server.

ARGUMENTS:
    TIMESTAMP           Optional. Specific backup timestamp to restore.
                       If not provided, uses the most recent backup.

OPTIONS:
    -d, --dry-run       Perform dry run without making changes
    -v, --verbose       Enable verbose output
    -f, --force         Force rollback without confirmation
    -l, --list          List available backups
    -h, --help          Show this help message

EXAMPLES:
    $0                          # Rollback to most recent backup
    $0 20240102_153045          # Rollback to specific timestamp
    $0 --list                   # List all available backups
    $0 --dry-run                # Test rollback without changes

EOF
    exit 0
}

# List available backups
list_backups() {
    print_message "$BLUE" "Available backups:"

    if [[ ! -d "$BACKUP_DIR" ]]; then
        print_message "$YELLOW" "No backups found"
        exit 0
    fi

    local backups=$(ls -t "$BACKUP_DIR"/index.ts.*.backup 2>/dev/null || true)

    if [[ -z "$backups" ]]; then
        print_message "$YELLOW" "No backups found"
        exit 0
    fi

    echo ""
    printf "%-5s %-20s %-40s %-10s\n" "No." "Timestamp" "File" "Size"
    printf "%-5s %-20s %-40s %-10s\n" "---" "-------------------" "----------------------------------------" "----------"

    local count=1
    while IFS= read -r backup; do
        local filename=$(basename "$backup")
        local timestamp=$(echo "$filename" | sed 's/index.ts.\(.*\).backup/\1/')
        local size=$(du -h "$backup" | cut -f1)
        printf "%-5s %-20s %-40s %-10s\n" "$count" "$timestamp" "$filename" "$size"
        ((count++))
    done <<< "$backups"

    echo ""
    exit 0
}

# Parse command line arguments
parse_args() {
    local list_mode=false
    local backup_timestamp=""

    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--dry-run)
                DRY_RUN=true
                shift
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -f|--force)
                FORCE=true
                shift
                ;;
            -l|--list)
                list_mode=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                backup_timestamp=$1
                shift
                ;;
        esac
    done

    if [[ "$list_mode" == true ]]; then
        list_backups
    fi

    echo "$backup_timestamp"
}

# Find backup file
find_backup() {
    local requested_timestamp=$1

    if [[ ! -d "$BACKUP_DIR" ]]; then
        error_exit "Backup directory not found: $BACKUP_DIR"
    fi

    if [[ -z "$requested_timestamp" ]]; then
        # Get most recent backup
        local backup=$(ls -t "$BACKUP_DIR"/index.ts.*.backup 2>/dev/null | head -n 1)
        if [[ -z "$backup" ]]; then
            error_exit "No backups found"
        fi
        echo "$backup"
    else
        # Find specific backup
        local backup="$BACKUP_DIR/index.ts.${requested_timestamp}.backup"
        if [[ ! -f "$backup" ]]; then
            error_exit "Backup not found for timestamp: $requested_timestamp"
        fi
        echo "$backup"
    fi
}

# Confirm rollback
confirm_rollback() {
    local backup_file=$1

    if [[ "$FORCE" == true ]] || [[ "$DRY_RUN" == true ]]; then
        return 0
    fi

    print_message "$YELLOW" "
WARNING: This will rollback to:
  Backup: $(basename "$backup_file")
  Created: $(date -r "$backup_file" '+%Y-%m-%d %H:%M:%S')

Current file will be backed up before rollback.
"

    read -p "Continue with rollback? (yes/no): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
        print_message "$YELLOW" "Rollback cancelled"
        exit 0
    fi
}

# Backup current file
backup_current() {
    print_message "$BLUE" "Backing up current file..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would backup current file"
        return 0
    fi

    if [[ -f "$ORIGINAL_FILE" ]]; then
        local current_backup="$BACKUP_DIR/index.ts.${TIMESTAMP}.pre-rollback"
        cp "$ORIGINAL_FILE" "$current_backup" || error_exit "Failed to backup current file"
        print_message "$GREEN" "Current file backed up: $current_backup"
    fi
}

# Restore backup
restore_backup() {
    local backup_file=$1

    print_message "$BLUE" "Restoring backup..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would restore: $backup_file -> $ORIGINAL_FILE"
        return 0
    fi

    cp "$backup_file" "$ORIGINAL_FILE" || error_exit "Failed to restore backup"

    print_message "$GREEN" "Backup restored successfully"
}

# Rebuild project
rebuild_project() {
    print_message "$BLUE" "Rebuilding project..."

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

# Validate rollback
validate_rollback() {
    print_message "$BLUE" "Validating rollback..."

    if [[ "$DRY_RUN" == true ]]; then
        print_message "$YELLOW" "[DRY RUN] Would validate rollback"
        return 0
    fi

    # Check if original file exists and is not empty
    if [[ ! -s "$ORIGINAL_FILE" ]]; then
        error_exit "Restored file is missing or empty"
    fi

    # Run validation script if it exists
    if [[ -f "$SCRIPT_DIR/validate-mcp.sh" ]]; then
        bash "$SCRIPT_DIR/validate-mcp.sh" || error_exit "Validation failed"
    fi

    print_message "$GREEN" "Rollback validation passed"
}

# Print summary
print_summary() {
    local backup_file=$1

    print_message "$GREEN" "
╔════════════════════════════════════════════════════════════════╗
║                     ROLLBACK SUCCESSFUL                        ║
╚════════════════════════════════════════════════════════════════╝

Rollback Details:
  • Timestamp:        $TIMESTAMP
  • Restored From:    $(basename "$backup_file")
  • Log File:         $LOG_FILE
  • Dry Run:          $DRY_RUN

Next Steps:
  1. Verify application functionality
  2. Run: npm start (to start the MCP server)
  3. Test the server with: npx @modelcontextprotocol/inspector

Note: Current version was backed up before rollback
"
}

# Main rollback flow
main() {
    print_message "$BLUE" "
╔════════════════════════════════════════════════════════════════╗
║         Database MCP Server - Rollback Script v1.0            ║
╚════════════════════════════════════════════════════════════════╝
"

    log "INFO" "Starting rollback process"

    # Parse arguments
    local requested_timestamp=$(parse_args "$@")

    # Find backup file
    local backup_file=$(find_backup "$requested_timestamp")
    print_message "$BLUE" "Found backup: $(basename "$backup_file")"

    # Confirm rollback
    confirm_rollback "$backup_file"

    # Execute rollback steps
    backup_current
    restore_backup "$backup_file"
    rebuild_project
    run_tests
    validate_rollback

    # Print summary
    print_summary "$backup_file"

    log "INFO" "Rollback completed successfully"
    exit 0
}

# Run main function
main "$@"
