#!/usr/bin/env bash
# Builds the web fonts in public/fonts from your own copy of the Timeless type family.
# The Timeless Free Font License doesn't allow the fonts in a public repository, so they aren't committed:
# download them free from https://timeless.co, then run:  scripts/fonts.sh /path/to/Timeless
# Needs fontTools with brotli:  pip install fonttools brotli
set -euo pipefail
src=${1:-$HOME/.local/share/fonts/Timeless}
out=$(dirname "$0")/../public/fonts
mkdir -p "$out"
for pair in TimelessSans-GroteskRegular:grotesk-400 TimelessSans-GroteskMedium:grotesk-500 TimelessSans-GroteskSemibold:grotesk-600 \
  TimelessSans-GroteskBold:grotesk-700 TimelessSans-SansMedium:sans-500 TimelessSerif-Light:serif-300 TimelessSerif-Regular:serif-400 \
  TimelessSerif-LightItalic:serif-300i; do
  pyftsubset "$src/${pair%%:*}.otf" \
    --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20AC,U+2122,U+2190-2199,U+2212,U+2215,U+2264-2265" \
    --layout-features='kern,liga,calt,tnum,lnum,pnum,case,ss01' --flavor=woff2 --output-file="$out/${pair##*:}.woff2"
done
echo "Fonts written to $out"
