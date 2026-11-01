import { pullProfile, type Account, type CloudFetch } from '../../core/profile/cloud.js';
import { seenMachine } from '../../core/profile/register.js';
import { gatherExtensions, type ExtensionsGather, type ProfileStatus } from '../extension/rows.js';

const STATUS_TIMEOUT_MS = 2_000;

// The account's profile when it moved past the local copy; null when the same or not known.
const accountProfile = async (fetch: CloudFetch, profile: ProfileStatus) => {
  if (profile.state !== 'ok' || profile.etag === null) return null;
  const pulled = await pullProfile(fetch, profile.etag, STATUS_TIMEOUT_MS);
  if (pulled.kind !== 'found') return null;
  return { version: pulled.doc.profile.version, etag: pulled.doc.etag };
};

// `status`: marks this machine seen (does the account know it?) and compares the profile copies.
export const gatherWithAccount = async (account: Account | null): Promise<ExtensionsGather> => {
  const gathered = await gatherExtensions();
  const { machine, profile } = gathered.status;
  const [registered, cloud] =
    account === null
      ? [null, null]
      : await Promise.all([
          seenMachine(account.fetch, machine.id),
          accountProfile(account.fetch, profile),
        ]);
  const compared = cloud !== null && profile.state === 'ok' ? { ...profile, cloud } : profile;
  const status = { ...gathered.status, machine: { ...machine, registered }, profile: compared };
  return { ...gathered, status };
};
