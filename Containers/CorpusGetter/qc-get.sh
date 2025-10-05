#!/usr/bin/env bash
set -euo pipefail

VOLUME="/QualitasCorpus"
SEED="/opt/qc-seed"
RELEASE="QualitasCorpus-20130901r"

stats() {
  echo
  echo "Statistics for QualitasCorpus"
  echo "------------------------------"
  if [ -d "$VOLUME/$RELEASE" ]; then
    # Creation time (may be empty on Alpine)
    stat "$VOLUME/$RELEASE" 2>/dev/null | sed -n 's/^Birth: /Creation time       : /p' || true
    echo -n "Size on disk        : "
    du -sh "$VOLUME/$RELEASE" | cut -f1
    echo -n "Number of files     : "
    find "$VOLUME/$RELEASE" -type f | wc -l
    echo -n "Number of Java files: "
    find "$VOLUME/$RELEASE" -type f -name "*.java" | wc -l
    echo -n "Size of Java files  : "
    find "$VOLUME/$RELEASE" -type f -name "*.java" -print0 | xargs -0 cat 2>/dev/null | wc -c | awk '{print $1 " total"}'
  else
    echo "Creation time       :"
    echo "Size on disk        :"
    echo "Number of files     : 0"
    echo "Number of Java files: 0"
    echo "Size of Java files  : 0 total"
  fi
}

seed_from_local_tars() {
  echo "Seeding $RELEASE into $VOLUME from local tar files..."
  mkdir -p "$VOLUME"

  # Copy tar files from the image into the mounted volume (optional but handy)
  shopt -s nullglob
  tars=( "$SEED"/QualitasCorpus-20130901r-pt*.tar )
  if (( ${#tars[@]} == 0 )); then
    echo "ERROR: No tar files found in $SEED. Make sure you placed the two .tar files in Containers/CorpusGetter before building."
    exit 1
  fi

  for f in "${tars[@]}"; do
    echo "Copying $(basename "$f") -> $VOLUME"
    cp -f "$f" "$VOLUME"/
  done

  cd "$VOLUME"
  for f in QualitasCorpus-20130901r-pt*.tar; do
    echo "Extracting $f ..."
    tar xf "$f"
  done

  if [ -f "$VOLUME/$RELEASE/bin/install.pl" ]; then
    echo "Running installer..."
    (cd "$VOLUME/$RELEASE" && perl bin/install.pl)
  else
    echo "ERROR: $VOLUME/$RELEASE/bin/install.pl not found."
    exit 1
  fi

  echo "Done seeding $RELEASE."
}

case "${1:-FETCH}" in
  FETCH)
    seed_from_local_tars
    stats
    ;;
  *)
    stats
    ;;
esac