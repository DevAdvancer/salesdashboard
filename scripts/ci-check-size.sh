#!/bin/bash
echo "Checking for files exceeding 600 lines..."

oversized_files=$(find app/ lib/ components/ -type f \( -name "*.ts" -o -name "*.tsx" \) -exec wc -l {} + 2>/dev/null | awk '$1 > 600 && $2 != "total" {print $2, "(" $1 " lines)"}')

if [ -n "$oversized_files" ]; then
  echo "⚠️  WARNING: The following files exceed 600 lines. Please refactor:"
  echo "$oversized_files"
  exit 0 # Non-blocking warning
fi

echo "✅ File sizes checked."
exit 0
