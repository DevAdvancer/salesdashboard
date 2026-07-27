#!/bin/bash
echo "Checking for new 'any' usages..."

# Get added lines from git diff
diff_output=$(git diff main -U0 app/ lib/ components/ 2>/dev/null || git diff origin/main -U0 app/ lib/ components/ 2>/dev/null)
new_anys=$(echo "$diff_output" | grep '^+[^+]' | grep -c -w 'any')

if [ "$new_anys" -gt 0 ]; then
  echo "⚠️  WARNING: You introduced $new_anys new 'any' usages."
  echo "To pay down technical debt, please replace them with proper typing or 'unknown'."
  exit 0 # Non-blocking warning
fi

echo "✅ No new 'any' usages introduced."
exit 0
