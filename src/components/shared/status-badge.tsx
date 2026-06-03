import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CircleCheck, Clock, CircleX, X, Ban, PhoneOff, Loader } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const clientCategoryStyles: Record<string, string> = {
  strata: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  residential: 'bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-300',
  cod: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300',
  do_not_trade: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
}

const funnelStageConfig: Record<string, { icon: LucideIcon; iconClass: string; textClass: string }> = {
  'Paid Job': { icon: CircleCheck, iconClass: 'text-green-600', textClass: 'text-green-800' },
  'Booked - Pending': { icon: Clock, iconClass: 'text-blue-600', textClass: 'text-blue-800' },
  'Booked - Did Not Complete': { icon: CircleX, iconClass: 'text-orange-500', textClass: 'text-orange-800' },
  'Not Booked': { icon: X, iconClass: 'text-red-500', textClass: 'text-red-800' },
  'Not Quotable': { icon: Ban, iconClass: 'text-gray-400', textClass: 'text-gray-600' },
  'Not Captured': { icon: PhoneOff, iconClass: 'text-gray-400', textClass: 'text-gray-600' },
  'Pending': { icon: Loader, iconClass: 'text-yellow-600', textClass: 'text-yellow-800' },
}

const profileStyles: Record<string, string> = {
  PTTR: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  ETTR: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
}

export function ClientCategoryBadge({ category }: { category: string }) {
  const key = category?.toLowerCase() ?? ''
  return (
    <Badge variant="secondary" className={cn('font-medium', clientCategoryStyles[key] ?? '')}>
      {category}
    </Badge>
  )
}

export function FunnelStageBadge({ stage }: { stage: string }) {
  const config = funnelStageConfig[stage]
  if (!config) return <span className="text-[13px] text-muted-foreground">{stage}</span>
  const Icon = config.icon
  return (
    <span className={cn('inline-flex items-center gap-1 text-[13px]', config.textClass)}>
      <Icon className={cn('h-3.5 w-3.5', config.iconClass)} />
      {stage}
    </span>
  )
}

export function ProfileBadge({ profile }: { profile: string }) {
  return (
    <Badge variant="secondary" className={cn('font-medium', profileStyles[profile] ?? '')}>
      {profile}
    </Badge>
  )
}

export function AfterHoursBadge() {
  return (
    <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300 font-medium">
      After Hours
    </Badge>
  )
}
