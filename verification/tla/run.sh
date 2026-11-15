#!/bin/sh
# Model-checks one TLA+ model with TLC 1.7.4 and lists every rule that breaks,
# with one shortest counterexample per broken rule.
#   verification/tla/run.sh <model-dir> [config.cfg]
# Needs Java 11+ (set JAVA) and tla2tools.jar 1.7.4 (set TLA2TOOLS), from
#   https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
# Exit 0: every rule held. Exit 1: some rule broke. Exit 2: TLC error.
set -eu
dir=${1:?usage: run.sh <model-dir> [config.cfg]}
spec=$(ls "$dir"/*.tla | head -n 1)
cfg=${2:-${spec%.tla}.cfg}
jar=${TLA2TOOLS:-$HOME/.cache/tla/tla2tools.jar}
java=${JAVA:-java}
want=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
got=$(sha256sum <"$jar" | cut -d' ' -f1)
[ "$got" = "$want" ] || { echo "tla2tools.jar at $jar is not TLC 1.7.4 (sha256 $got)" >&2; exit 2; }

out=$(mktemp -d)
cp "$cfg" "$out/run.cfg"
specdir=$(cd "$(dirname "$spec")" && pwd)
broken=""
# TLC stops at the first broken rule, so drop each broken rule and rerun until the rest hold.
while :; do
  log=$out/tlc.log
  # TLC resolves the module name against the working directory, so run beside the spec.
  (cd "$specdir" && "$java" -XX:+UseParallelGC -cp "$jar" tlc2.TLC -workers auto \
    -metadir "$out/meta" -config "$out/run.cfg" "$(basename "$spec")") >"$log" 2>&1 || true
  rule=$(grep -oE "(Invariant|Action property) [A-Za-z0-9_]+ is violated" "$log" | head -n 1 | cut -d' ' -f2 || true)
  [ "$rule" = "property" ] && rule=$(grep -oE "Action property [A-Za-z0-9_]+ is violated" "$log" | head -n 1 | cut -d' ' -f3)
  if [ -z "$rule" ]; then
    if ! grep -q "Model checking completed. No error has been found." "$log"; then
      echo "TLC error; full output: $log" >&2; exit 2
    fi
    grep -E "distinct states found" "$log" | tail -n 1
    break
  fi
  mv "$log" "$out/$rule.out"
  broken="$broken $rule"
  sed -i "/^[[:space:]]*$rule[[:space:]]*\$/d" "$out/run.cfg"
done

if [ -n "$broken" ]; then
  for r in $broken; do echo "BROKEN $r   trace: $out/$r.out"; done
  echo "every other rule holds"
  exit 1
fi
echo "all rules hold"
