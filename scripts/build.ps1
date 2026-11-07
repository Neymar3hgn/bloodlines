# Builds the contracts into res/. Uses a short target folder because Windows limits path length.
$tools = "$env:LOCALAPPDATA\clade-tools"
if (Test-Path $tools) { $env:CARGO_TARGET_DIR = "$tools\t"; $opt = "$tools\binaryen\bin\wasm-opt.exe" } else { $opt = "wasm-opt"; $env:CARGO_TARGET_DIR = "contracts\target" }
Push-Location contracts
cargo build --release --target wasm32-unknown-unknown -p clade-agent -p clade-colony -p clade-tusd -p clade-asker -p clade-reader -p clade-clean
Pop-Location
foreach ($n in 'clade_agent', 'clade_colony', 'clade_tusd', 'clade_asker', 'clade_reader', 'clade_clean') {
  & $opt "$env:CARGO_TARGET_DIR\wasm32-unknown-unknown\release\$n.wasm" -Oz --enable-bulk-memory --enable-sign-ext --enable-mutable-globals --enable-nontrapping-float-to-int --enable-multivalue --enable-reference-types --llvm-memory-copy-fill-lowering --signext-lowering --strip-debug --strip-producers -o "res\$n.wasm"
}
Get-ChildItem res\*.wasm | Select-Object Name, Length
