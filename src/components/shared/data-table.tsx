'use client'

import {
  type ColumnDef,
  type Column,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import { Button } from '@/components/ui/button'
import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100, 500, 1000] as const
const BG_WHITE = '#ffffff'
const BG_STRIPE = '#f7f7f8'

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  onRowClick?: (row: TData) => void
  filterControls?: React.ReactNode
  defaultPageSize?: number
  frozenColumns?: number
  enableColumnFilters?: boolean
}

// Excel-style dropdown filter for a column
function ColumnFilterDropdown<TData>({
  column,
  data,
}: {
  column: Column<TData, unknown>
  data: TData[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const filterValue = column.getFilterValue() as string | undefined

  const uniqueValues = useMemo(() => {
    const accessor = column.id
    const vals = new Set<string>()
    for (const row of data) {
      const v = (row as Record<string, unknown>)[accessor]
      if (v != null && v !== '') vals.add(String(v))
    }
    return Array.from(vals).sort((a, b) => a.localeCompare(b))
  }, [column.id, data])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const isFiltered = filterValue != null

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className={`ml-1 inline-flex items-center rounded p-0.5 hover:bg-muted ${isFiltered ? 'text-primary' : 'text-muted-foreground'}`}
        title="Filter"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-48 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
            onClick={(e) => { e.stopPropagation(); column.setFilterValue(undefined); setOpen(false) }}
          >
            <span className="w-4">{!isFiltered ? <Check className="h-3.5 w-3.5" /> : null}</span>
            <span className="text-muted-foreground">(All)</span>
          </button>
          {uniqueValues.map((val) => (
            <button
              key={val}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              onClick={(e) => { e.stopPropagation(); column.setFilterValue(val); setOpen(false) }}
            >
              <span className="w-4">{filterValue === val ? <Check className="h-3.5 w-3.5" /> : null}</span>
              <span className="truncate">{val}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function DataTable<TData, TValue>({
  columns,
  data,
  onRowClick,
  filterControls,
  defaultPageSize = 50,
  frozenColumns = 0,
  enableColumnFilters = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: defaultPageSize })
  const [frozenOffsets, setFrozenOffsets] = useState<number[]>([])
  const headerRowRef = useRef<HTMLTableRowElement>(null)

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: setPagination,
    state: { sorting, columnFilters, pagination },
  })

  // Measure actual rendered header cell widths to compute left offsets
  const measureOffsets = useCallback(() => {
    if (!headerRowRef.current || frozenColumns === 0) return
    const cells = headerRowRef.current.children
    const offsets: number[] = []
    let cumulative = 0
    for (let i = 0; i < frozenColumns && i < cells.length; i++) {
      offsets.push(cumulative)
      cumulative += (cells[i] as HTMLElement).offsetWidth
    }
    setFrozenOffsets(offsets)
  }, [frozenColumns])

  useEffect(() => {
    measureOffsets()
    window.addEventListener('resize', measureOffsets)
    return () => window.removeEventListener('resize', measureOffsets)
  }, [measureOffsets, data, pagination])

  // Re-measure after initial paint
  useEffect(() => {
    const id = requestAnimationFrame(measureOffsets)
    return () => cancelAnimationFrame(id)
  }, [measureOffsets])

  const hasFrozen = frozenColumns > 0 && frozenOffsets.length === frozenColumns

  return (
    <div className="space-y-4">
      {filterControls}
      <div className="rounded-md border overflow-auto max-h-[80vh]">
        <table
          className="w-full caption-bottom text-sm"
          style={{ borderCollapse: 'separate', borderSpacing: 0 }}
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} ref={headerRowRef}>
                {headerGroup.headers.map((header, i) => {
                  const isFrozen = hasFrozen && i < frozenColumns
                  const isLastFrozen = hasFrozen && i === frozenColumns - 1
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'h-8 px-2 text-left align-middle font-medium whitespace-nowrap border-b',
                        'text-[11px] uppercase tracking-[0.05em] text-muted-foreground',
                      )}
                      style={{
                        position: 'sticky',
                        top: 0,
                        zIndex: isFrozen ? 30 : 20,
                        backgroundColor: BG_WHITE,
                        ...(isFrozen ? { left: frozenOffsets[i] } : {}),
                        ...(isLastFrozen ? { boxShadow: '2px 0 4px -2px rgba(0,0,0,0.15)' } : {}),
                      }}
                    >
                      {header.isPlaceholder ? null : (
                        <div className="flex items-center">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {enableColumnFilters && header.column.getCanFilter() && (
                            <ColumnFilterDropdown column={header.column} data={data} />
                          )}
                        </div>
                      )}
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => {
                const isOdd = row.index % 2 === 1
                const rowBg = isOdd ? BG_STRIPE : BG_WHITE
                return (
                  <tr
                    key={row.id}
                    className={cn(
                      'transition-colors',
                      onRowClick && 'cursor-pointer',
                    )}
                    style={{ backgroundColor: rowBg }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f0f0f1' }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = rowBg }}
                  >
                    {row.getVisibleCells().map((cell, i) => {
                      const isFrozen = hasFrozen && i < frozenColumns
                      const isLastFrozen = hasFrozen && i === frozenColumns - 1
                      return (
                        <td
                          key={cell.id}
                          className="px-2 py-1 align-middle whitespace-nowrap border-b text-[13px] text-foreground"
                          onClick={() => onRowClick?.(row.original)}
                          style={isFrozen ? {
                            position: 'sticky',
                            left: frozenOffsets[i],
                            zIndex: 10,
                            backgroundColor: 'inherit',
                            ...(isLastFrozen ? { boxShadow: '2px 0 4px -2px rgba(0,0,0,0.15)' } : {}),
                          } : undefined}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={columns.length} className="h-24 text-center p-2">
                  No results.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Rows per page</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value={pagination.pageSize}
            onChange={(e) => {
              table.setPageSize(Number(e.target.value))
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>{size}</option>
            ))}
          </select>
          <span>
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–{Math.min(
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
              table.getFilteredRowModel().rows.length
            )} of {table.getFilteredRowModel().rows.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}
