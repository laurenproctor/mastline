import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  /*
   * The marked-preview route renders with sharp, and sharp's native binary
   * finds libvips through its RPATH: the shared library is loaded by the
   * dynamic linker, never `require`d, so output file tracing (which follows
   * `require`) ships `@img/sharp-linux-x64/lib/*.node` into the function and
   * leaves `@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.*` behind. On
   * Vercel that surfaced as ERR_DLOPEN_FAILED on every preview request. Both
   * platform packages are named explicitly for that one route. The patterns
   * match nothing on a macOS checkout, where the linux packages are not
   * installed, and only ever add files to this one function.
   * scripts/check-preview-trace.mjs proves the pair is in the trace after a
   * Linux build.
   */
  outputFileTracingIncludes: {
    "/d/\\[token\\]/preview/\\[assetId\\]": [
      "node_modules/@img/sharp-linux-x64/lib/**/*",
      "node_modules/@img/sharp-libvips-linux-x64/lib/**/*",
    ],
  },
};

export default nextConfig;
