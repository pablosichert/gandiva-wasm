PROJECT_DIR="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)"

$PROJECT_DIR/scripts/build_openssl.sh "$1"
$PROJECT_DIR/scripts/build_llvm.sh "$1"
$PROJECT_DIR/scripts/build_gandiva.sh "$1"
