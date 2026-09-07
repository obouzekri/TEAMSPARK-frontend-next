'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import useI18n from '@/lib/i18n/useI18n';

export default function ParticipantSecurityPage() {
  const router = useRouter();
  const { withLocalePath } = useI18n();

  useEffect(() => {
    router.replace(withLocalePath('/account?tab=security'));
  }, [router, withLocalePath]);

  return null;
}
