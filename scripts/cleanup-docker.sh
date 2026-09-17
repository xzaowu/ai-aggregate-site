#!/usr/bin/env sh
set -eu

docker image prune -f
docker builder prune -f
