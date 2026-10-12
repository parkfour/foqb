#!/bin/sh
# Publishes this repository's history to a public mirror, one commit at a
# time, without the paths listed in .gitdontforward (.gitignore syntax).
#
# The mirror's history starts at its first publish: one commit holding the
# whole tree. After that, every new first-parent commit on the current
# branch becomes one mirror commit, with the same message, author and
# author date. A note on each mirror commit (refs/notes/mirror) records
# the source commit it came from, so each run continues where the last one
# stopped. The mirror is never force-pushed; a push to it from anywhere
# else makes this fail rather than overwrite it.
#
# usage: scripts/publish-mirror.sh <mirror URL> [branch]
# MIRROR_AUTHOR_NAME / MIRROR_AUTHOR_EMAIL, if set, replace every author.
set -eu

url=${1:?usage: publish-mirror.sh <mirror URL> [branch]}
branch=${2:-main}
notes=refs/notes/mirror

git fetch -q "$url" "+refs/heads/$branch:refs/mirror/tip" 2>/dev/null || true
git fetch -q "$url" "+$notes:$notes" 2>/dev/null || true
tip=$(git rev-parse -q --verify refs/mirror/tip || true)

# The commit's tree minus .gitdontforward's paths (as of that commit).
filtered_tree() {
  index=$(mktemp)
  GIT_INDEX_FILE=$index git read-tree "$1"
  if git cat-file -e "$1:.gitdontforward" 2>/dev/null; then
    git show "$1:.gitdontforward" >"$index.exclude"
    GIT_INDEX_FILE=$index git ls-files -z --cached --ignored --exclude-from="$index.exclude" |
      GIT_INDEX_FILE=$index git update-index -z --force-remove --stdin
  fi
  GIT_INDEX_FILE=$index git write-tree
  rm -f "$index" "$index.exclude"
}

# usage: mirror_commit <source commit> <tree> <message> [-p parent]
mirror_commit() {
  source=$1 tree=$2 message=$3
  shift 3
  name=${MIRROR_AUTHOR_NAME:-$(git log -1 --format=%an "$source")}
  email=${MIRROR_AUTHOR_EMAIL:-$(git log -1 --format=%ae "$source")}
  commit=$(printf '%s\n' "$message" |
    GIT_AUTHOR_NAME=$name GIT_AUTHOR_EMAIL=$email GIT_AUTHOR_DATE=$(git log -1 --format=%aI "$source") \
    GIT_COMMITTER_NAME=$name GIT_COMMITTER_EMAIL=$email \
    git commit-tree "$tree" "$@")
  GIT_COMMITTER_NAME=$name GIT_COMMITTER_EMAIL=$email GIT_AUTHOR_NAME=$name GIT_AUTHOR_EMAIL=$email \
    git notes --ref=mirror add -m "$source" "$commit"
  echo "$commit"
}

head=$(git rev-parse HEAD)
if [ -z "$tip" ]; then
  current=$(mirror_commit "$head" "$(filtered_tree "$head")" "Initial public release")
  echo "publishing the initial commit"
else
  last=$(git notes --ref=mirror show "$tip")
  current=$tip
  for source in $(git rev-list --reverse --first-parent "$last..$head"); do
    tree=$(filtered_tree "$source")
    # Nothing public changed (only .gitdontforward paths): nothing to publish.
    [ "$tree" = "$(git rev-parse "$current^{tree}")" ] && continue
    current=$(mirror_commit "$source" "$tree" "$(git log -1 --format=%B "$source")" -p "$current")
    echo "publishing $(git log -1 --format='%h %s' "$source")"
  done
fi

if [ "$current" = "$tip" ]; then
  echo "mirror already up to date"
  exit 0
fi
git push -q "$url" "$current:refs/heads/$branch" "$notes:$notes"
