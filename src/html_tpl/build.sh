#!/usr/bin/bash

if [ ! "$#" = "2" ]; then
  echo "usage: $0 metadata.json benchdata.json"
  exit 1
fi

metadata_path="$1"
benchdata_path="$2"

if [ ! -f "$metadata_path" ]; then
  echo "metadata file does not exist"
  exit 1
fi

if [ ! -f "$benchdata_path" ]; then
  echo "benchdata file does not exist"
  exit 1
fi

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)

style_path=$SCRIPT_DIR/style.css
script_path=$SCRIPT_DIR/script.js

cat <<EOF
<!DOCTYPE html>
<html>
    <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, minimum-scale=1.0, initial-scale=1, user-scalable=yes" />
        <style>
        $(cat $style_path)
        </style>
        <title>Benchmarks</title>
    </head>

    <body>
        <header id="header">
            <div class="header-item">
                <strong class="header-label">Last Update:</strong>
                <span id="last-update"></span>
            </div>
            <div class="header-item">
                <strong class="header-label">Repository:</strong>
                <a id="repository-link" rel="noopener"></a>
            </div>
            <div class="header-item">
                <strong class="header-label">PR:</strong>
                <a id="pr-link" rel="noopener"></a>
            </div>
            <div class="header-item">
                <strong class="header-label">Current HEAD:</strong>
                <a id="commit-link" rel="noopener"></a>
            </div>
        </header>
        <main id="main">
            <div class="dropdowns">
                <div id="benchmark-set-dropdown"></div>
            </div>
            <div id="body"></div>
        </main>
        <footer></footer>

        <script src="https://cdn.plot.ly/plotly-3.0.0.min.js" charset="utf-8"></script>
        <script id="main-script">
          window.METADATA=$(cat $metadata_path);
          window.BENCHMARK_DATA=$(cat $benchdata_path);
          $(cat $script_path)
        </script>
    </body>
</html>
EOF
