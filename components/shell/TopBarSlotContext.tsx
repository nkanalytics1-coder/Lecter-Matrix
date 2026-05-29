'use client'

import {
  createContext,
  useContext,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'

interface TopBarSlotContextValue {
  slot: ReactNode
  setSlot: (node: ReactNode) => void
}

const TopBarSlotContext = createContext<TopBarSlotContextValue>({
  slot: null,
  setSlot: () => undefined,
})

export function TopBarSlotProvider({
  children,
}: {
  children: ReactNode
}): ReactElement {
  const [slot, setSlot] = useState<ReactNode>(null)
  return (
    <TopBarSlotContext.Provider value={{ slot, setSlot }}>
      {children}
    </TopBarSlotContext.Provider>
  )
}

export function useTopBarSlot(): TopBarSlotContextValue {
  return useContext(TopBarSlotContext)
}
