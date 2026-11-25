import { cookies } from 'next/headers';
import HelpCenter from '../../components/HelpCenter';
import { readAdmin } from '../../lib/server/admin-auth.mjs';

export default async function Page() {
  const admin = await readAdmin(await cookies()).catch(() => null);
  return <HelpCenter showAdmin={Boolean(admin)} />;
}
