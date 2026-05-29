import type { ReactElement } from 'react'
import { requireSession } from '@/server/auth'
import { Wizard } from '@/components/onboarding/Wizard'

export default async function OnboardingPage(): Promise<ReactElement> {
  await requireSession()

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-lg">
        <Wizard />
      </div>
    </div>
  )
}
