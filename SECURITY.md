# Security policy

## Reporting a vulnerability

Please don't open a public issue. Report it privately through
[GitHub's vulnerability reporting](https://github.com/sevheng/copane/security/advisories/new),
with steps to reproduce and the version (`ce --version`).

You'll get a reply within a week. Fixes ship in a new release, and the advisory is published once
users can upgrade (`ce --upgrade`).

## Supported versions

Only the latest release gets security fixes.

## Scope

copane runs your AI CLI and language servers with your permissions, and opens the files you point
it at. Reports about what those tools do on their own belong to their projects. Issues in how
copane starts them, passes them input, or handles files, configs and downloads (`install.sh`,
`--upgrade`) are in scope.
