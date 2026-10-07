#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_dir="$repo_root/appwork"
output_dir="$repo_root/dist"

test -f "$source_dir/index.html"
rm -rf "$output_dir"
mkdir -p "$output_dir/css" "$output_dir/image" "$output_dir/js" "$output_dir/onboarding"

cp "$source_dir/index.html" "$output_dir/index.html"
cp "$source_dir/_headers" "$output_dir/_headers"
cp "$source_dir/css/styles.css" "$output_dir/css/styles.css"
cp "$source_dir/image/tab.png" "$output_dir/image/tab.png"
cp "$source_dir/js/app.js" "$output_dir/js/app.js"
cp "$source_dir/js/gmail-config.js" "$output_dir/js/gmail-config.js"
cp "$source_dir/js/supabase-config.js" "$output_dir/js/supabase-config.js"
cp "$source_dir/onboarding/index.html" "$output_dir/onboarding/index.html"
cp "$source_dir/onboarding/change-test.html" "$output_dir/onboarding/change-test.html"
cp "$source_dir/onboarding/onboarding.js" "$output_dir/onboarding/onboarding.js"