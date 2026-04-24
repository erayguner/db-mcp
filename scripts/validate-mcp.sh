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
DIST_DIR="$PROJECT_ROOT/dist"
LOG_FILE="$PROJECT_ROOT/validation.log"

# Validation results
PASSED=0
FAILED=0
WARNINGS=0

# Flags
VERBOSE=false
STRICT=false
QUICK=false

# Logging function
log() {
    local level=$1
    shift
    local message="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] [$level] $message" | tee -a "$LOG_FILE"
}

# Print colored message
print_message() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Print test result
print_result() {
    local status=$1
    local test_name=$2
    local details=${3:-}

    case $status in
        PASS)
            print_message "$GREEN" "✓ $test_name"
            ((PASSED++))
            log "PASS" "$test_name"
            ;;
        FAIL)
            print_message "$RED" "✗ $test_name"
            if [[ -n "$details" ]]; then
                print_message "$RED" "  └─ $details"
            fi
            ((FAILED++))
            log "FAIL" "$test_name - $details"
            ;;
        WARN)
            print_message "$YELLOW" "⚠ $test_name"
            if [[ -n "$details" ]]; then
                print_message "$YELLOW" "  └─ $details"
            fi
            ((WARNINGS++))
            log "WARN" "$test_name - $details"
            ;;
    esac
}

# Print usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Validate Database MCP Server deployment and health.

OPTIONS:
    -v, --verbose       Enable verbose output
    -s, --strict        Fail on warnings
    -q, --quick         Skip slow validation tests
    -h, --help          Show this help message

VALIDATION CHECKS:
    • File Structure
    • TypeScript Compilation
    • Import Validation
    • Code Linting
    • Unit Tests
    • Build Artifacts
    • Type Checking
    • Dependencies

EXAMPLES:
    $0                  # Run all validation checks
    $0 --strict         # Fail on any warnings
    $0 --quick          # Skip slow tests

EXIT CODES:
    0 - All validations passed
    1 - One or more validations failed
    2 - Warnings found (only with --strict)

EOF
    exit 0
}

# Parse command line arguments
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -s|--strict)
                STRICT=true
                shift
                ;;
            -q|--quick)
                QUICK=true
                shift
                ;;
            -h|--help)
                usage
                ;;
            *)
                print_message "$RED" "Unknown option: $1"
                usage
                ;;
        esac
    done
}

# Check file structure
check_file_structure() {
    print_message "$BLUE" "\n━━━ File Structure Validation ━━━"

    # Required files
    local required_files=(
        "package.json"
        "tsconfig.json"
        "src/index.ts"
        ".gitignore"
    )

    for file in "${required_files[@]}"; do
        if [[ -f "$PROJECT_ROOT/$file" ]]; then
            print_result "PASS" "Required file exists: $file"
        else
            print_result "FAIL" "Missing required file: $file"
        fi
    done

    # Check if source files are not empty
    if [[ -s "$SRC_DIR/index.ts" ]]; then
        print_result "PASS" "Source file is not empty"
    else
        print_result "FAIL" "Source file is empty or missing"
    fi

    # Check directory structure
    local required_dirs=("src" "scripts")
    for dir in "${required_dirs[@]}"; do
        if [[ -d "$PROJECT_ROOT/$dir" ]]; then
            print_result "PASS" "Required directory exists: $dir"
        else
            print_result "FAIL" "Missing required directory: $dir"
        fi
    done
}

# Verify TypeScript imports
check_imports() {
    print_message "$BLUE" "\n━━━ Import Validation ━━━"

    local index_file="$SRC_DIR/index.ts"

    # Check for required imports
    local required_imports=(
        "@modelcontextprotocol/sdk/server/index.js"
        "@modelcontextprotocol/sdk/types.js"
    )

    for import in "${required_imports[@]}"; do
        if grep -q "$import" "$index_file"; then
            print_result "PASS" "Import found: $import"
        else
            print_result "FAIL" "Missing import: $import"
        fi
    done

    # Check for export statements
    if grep -q "export" "$index_file"; then
        print_result "PASS" "Export statements found"
    else
        print_result "WARN" "No export statements found" "May not be required"
    fi
}

# Run TypeScript type checking
check_types() {
    print_message "$BLUE" "\n━━━ Type Checking ━━━"

    cd "$PROJECT_ROOT"

    if [[ "$QUICK" == true ]]; then
        print_result "WARN" "Type checking skipped (--quick mode)"
        return 0
    fi

    if command -v npx &> /dev/null; then
        if [[ "$VERBOSE" == true ]]; then
            if npx tsc --noEmit; then
                print_result "PASS" "TypeScript type checking passed"
            else
                print_result "FAIL" "TypeScript type checking failed"
            fi
        else
            if npx tsc --noEmit > /dev/null 2>&1; then
                print_result "PASS" "TypeScript type checking passed"
            else
                print_result "FAIL" "TypeScript type checking failed" "Run with --verbose for details"
            fi
        fi
    else
        print_result "WARN" "TypeScript compiler not available"
    fi
}

# Run linting
check_linting() {
    print_message "$BLUE" "\n━━━ Code Linting ━━━"

    cd "$PROJECT_ROOT"

    if [[ "$QUICK" == true ]]; then
        print_result "WARN" "Linting skipped (--quick mode)"
        return 0
    fi

    # Check if lint script exists
    if ! grep -q '"lint"' package.json; then
        print_result "WARN" "No lint script found in package.json"
        return 0
    fi

    if [[ "$VERBOSE" == true ]]; then
        if npm run lint; then
            print_result "PASS" "Linting passed"
        else
            print_result "WARN" "Linting found issues" "Not critical"
        fi
    else
        if npm run lint > /dev/null 2>&1; then
            print_result "PASS" "Linting passed"
        else
            print_result "WARN" "Linting found issues" "Run with --verbose for details"
        fi
    fi
}

# Run unit tests
check_tests() {
    print_message "$BLUE" "\n━━━ Unit Tests ━━━"

    cd "$PROJECT_ROOT"

    if [[ "$QUICK" == true ]]; then
        print_result "WARN" "Tests skipped (--quick mode)"
        return 0
    fi

    # Check if test script exists
    if ! grep -q '"test"' package.json; then
        print_result "WARN" "No test script found in package.json"
        return 0
    fi

    if [[ "$VERBOSE" == true ]]; then
        if npm test; then
            print_result "PASS" "All tests passed"
        else
            print_result "FAIL" "Tests failed"
        fi
    else
        if npm test > /dev/null 2>&1; then
            print_result "PASS" "All tests passed"
        else
            print_result "FAIL" "Tests failed" "Run with --verbose for details"
        fi
    fi
}

# Check build artifacts
check_build() {
    print_message "$BLUE" "\n━━━ Build Artifacts ━━━"

    # Check if dist directory exists
    if [[ -d "$DIST_DIR" ]]; then
        print_result "PASS" "Build directory exists"

        # Check main build file
        if [[ -f "$DIST_DIR/index.js" ]]; then
            print_result "PASS" "Main build file exists"

            # Check if build file is not empty
            if [[ -s "$DIST_DIR/index.js" ]]; then
                print_result "PASS" "Build file is not empty"
            else
                print_result "FAIL" "Build file is empty"
            fi
        else
            print_result "FAIL" "Main build file missing"
        fi
    else
        print_result "FAIL" "Build directory not found" "Run: npm run build"
    fi
}

# Check dependencies
check_dependencies() {
    print_message "$BLUE" "\n━━━ Dependencies ━━━"

    cd "$PROJECT_ROOT"

    # Check if node_modules exists
    if [[ -d "node_modules" ]]; then
        print_result "PASS" "node_modules directory exists"
    else
        print_result "FAIL" "node_modules not found" "Run: npm install"
        return
    fi

    # Check for required packages
    local required_packages=(
        "@modelcontextprotocol/sdk"
        "zod"
    )

    for package in "${required_packages[@]}"; do
        if [[ -d "node_modules/$package" ]]; then
            print_result "PASS" "Required package installed: $package"
        else
            print_result "FAIL" "Missing required package: $package"
        fi
    done

    # Check for security vulnerabilities (if npm audit is available)
    if [[ "$QUICK" == false ]]; then
        if npm audit --audit-level=high > /dev/null 2>&1; then
            print_result "PASS" "No high/critical security vulnerabilities"
        else
            print_result "WARN" "Security vulnerabilities found" "Run: npm audit"
        fi
    fi
}

# Check for compilation errors
check_compilation() {
    print_message "$BLUE" "\n━━━ Compilation Check ━━━"

    cd "$PROJECT_ROOT"

    if [[ "$QUICK" == true ]]; then
        print_result "WARN" "Compilation check skipped (--quick mode)"
        return 0
    fi

    # Try to compile
    if [[ "$VERBOSE" == true ]]; then
        if npm run build; then
            print_result "PASS" "Compilation successful"
        else
            print_result "FAIL" "Compilation failed"
        fi
    else
        if npm run build > /dev/null 2>&1; then
            print_result "PASS" "Compilation successful"
        else
            print_result "FAIL" "Compilation failed" "Run with --verbose for details"
        fi
    fi
}

# Print summary
print_summary() {
    local total=$((PASSED + FAILED + WARNINGS))

    print_message "$BLUE" "
╔════════════════════════════════════════════════════════════════╗
║                    VALIDATION SUMMARY                          ║
╚════════════════════════════════════════════════════════════════╝
"

    printf "Total Checks:  %d\n" "$total"
    printf "${GREEN}Passed:        %d${NC}\n" "$PASSED"
    printf "${RED}Failed:        %d${NC}\n" "$FAILED"
    printf "${YELLOW}Warnings:      %d${NC}\n\n" "$WARNINGS"

    if [[ $FAILED -eq 0 ]] && [[ $WARNINGS -eq 0 ]]; then
        print_message "$GREEN" "✓ All validations passed successfully!"
        print_message "$GREEN" "  The MCP server is ready for deployment."
    elif [[ $FAILED -eq 0 ]]; then
        print_message "$YELLOW" "⚠ Validation completed with warnings"
        print_message "$YELLOW" "  Review warnings before deployment."
    else
        print_message "$RED" "✗ Validation failed!"
        print_message "$RED" "  Fix errors before deployment."
    fi

    echo ""
    print_message "$BLUE" "Log file: $LOG_FILE"
}

# Main validation flow
main() {
    print_message "$BLUE" "
╔════════════════════════════════════════════════════════════════╗
║       Database MCP Server - Validation Script v1.0            ║
╚════════════════════════════════════════════════════════════════╝
"

    log "INFO" "Starting validation process"

    # Parse arguments
    parse_args "$@"

    # Run validation checks
    check_file_structure
    check_imports
    check_dependencies
    check_types
    check_linting
    check_compilation
    check_build
    check_tests

    # Print summary
    print_summary

    # Determine exit code
    if [[ $FAILED -gt 0 ]]; then
        log "ERROR" "Validation failed with $FAILED errors"
        exit 1
    elif [[ "$STRICT" == true ]] && [[ $WARNINGS -gt 0 ]]; then
        log "WARN" "Validation completed with $WARNINGS warnings (strict mode)"
        exit 2
    else
        log "INFO" "Validation completed successfully"
        exit 0
    fi
}

# Run main function
main "$@"
