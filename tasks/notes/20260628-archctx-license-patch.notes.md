# archctx npm license patch

The public npm product package is `archctx`, generated from the private
workspace source packages during the FG6 release dry-run flow. `archctx@0.1.4`
was already published with `license: UNLICENSED`; npm package metadata for a
published version cannot be changed in place, so the smallest correct repair is
a patch release.

This slice prepares `archctx@0.1.5` with the generated npm manifest set to
`license: Apache-2.0`. The source workspace versions, product-version manifest,
practice catalog manifest digest, local tarball smoke evidence, and npm dry-run
evidence are version-aligned to keep the one-package release artifact coherent.

ModelContext remains outside this release path. It should not consume the
`archctx` CLI package as a contracts dependency; that package remains the
installed product surface.
