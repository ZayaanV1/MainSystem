/**
 * Stands in for @supabase/storage-js, which supabase-js constructs on every
 * client and this app never uses: no file in src reads `supabase.storage`,
 * and tests/vendor.test.ts fails the build if one ever does.
 *
 * Bundled for real it brought iceberg-js with it, and together they were the
 * difference between the first screen's JavaScript fitting its 150 KB budget
 * and not. The constructor does nothing, so building the client is
 * unaffected; any use throws, loudly, rather than failing silently.
 */

export class StorageApiError extends Error {
  status = 0;
}

export class StorageClient {
  constructor(..._args: unknown[]) {}

  from(): never {
    throw new Error('Storage is not bundled in this app. See src/lib/vendor/storage-stub.ts.');
  }
}
