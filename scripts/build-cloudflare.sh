#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/.." && pwd)"
source_dir="$repo_root/src/frontend"
output_dir="$repo_root/dist"
module_paths=()
while IFS= read -r module_path; do
  module_path="${module_path%$'\r'}"
  if [[ -n "$module_path" ]]; then
    module_paths+=("$module_path")
  fi
done < "$script_dir/js-modules.txt"

test -f "$source_dir/index.html"
rm -rf "$output_dir"
mkdir -p "$output_dir/css" "$output_dir/images" "$output_dir/js" "$output_dir/onboarding"

cp "$source_dir/index.html" "$output_dir/index.html"
cp "$source_dir/_headers" "$output_dir/_headers"
cp "$source_dir/css/styles.css" "$output_dir/css/styles.css"
cp "$source_dir/images/tab.png" "$output_dir/images/tab.png"
cp "$source_dir/js/gmail-config.js" "$output_dir/js/gmail-config.js"
cp "$source_dir/js/supabase-config.js" "$output_dir/js/supabase-config.js"
cp "$source_dir/onboarding/index.html" "$output_dir/onboarding/index.html"
cp "$source_dir/onboarding/change-test.html" "$output_dir/onboarding/change-test.html"
cp "$source_dir/onboarding/onboarding.js" "$output_dir/onboarding/onboarding.js"

{
  printf "(() => {\n  'use strict';\n\n"
  first_module=true
  for module_path in "${module_paths[@]}"; do
    if [[ "$first_module" == false ]]; then
      printf "\n"
    fi
    cat "$source_dir/js/modules/$module_path"
    first_module=false
  done
  printf "\n})();\n"
} > "$output_dir/js/app.js"