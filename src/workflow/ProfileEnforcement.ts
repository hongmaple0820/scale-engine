/**
 * Shared verification-profile escalation predicate.
 *
 * `default` and `auto` stay advisory. Profiles named or suffixed with
 * `full`, `ci`, or `strict` are enforced.
 */
export function isEnforcedProfile(profileName: string | undefined): boolean {
  if (!profileName) return false
  return /(?:^|[:_-])(?:full|ci|strict)$/i.test(profileName)
}
