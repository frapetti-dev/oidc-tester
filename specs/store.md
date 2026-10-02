# JSON document storage

Rust commands `doc_read`, `doc_write`, `doc_list`, `doc_delete` under `<app_data_dir>/data`; documents are opaque JSON.

### REQ-STORE-001 Atomic write

Status: Accepted

Given `doc_write(path, value)`
When it runs
Then the JSON is written to `<file>.tmp` and renamed over the target, parent directories are created, and no `.tmp` remains
And `doc_read` of a missing path returns `None`

### REQ-STORE-002 Path validation

Status: Accepted

Given a path that is empty, absolute, or has a `..`, `\` or `:` segment
When any `doc_*` command is called
Then it fails with the error `invalid path` and touches no file

### REQ-STORE-003 List and delete

Status: Accepted

Given a directory containing `*.json` files, other files and subdirectories
When `doc_list(dir)` runs
Then it returns, sorted and de-duplicated, the file stems of the `*.json` files directly inside `dir` plus the names of its immediate subdirectories (e.g. `a.json`, `b.json`, `c.txt` and `d/` give `["a","b","d"]`)
And a missing `dir` returns an empty list
And `doc_delete(path)` removes a file or a directory recursively
