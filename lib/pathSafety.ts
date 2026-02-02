import path from "path";

export function isPathInside(baseDir: string, targetPath: string): boolean {
  const relative = path.relative(baseDir, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolveSafePath(
  baseDir: string,
  targetPath: string
): string | null {
  const resolved = path.resolve(baseDir, targetPath);
  return isPathInside(baseDir, resolved) ? resolved : null;
}
