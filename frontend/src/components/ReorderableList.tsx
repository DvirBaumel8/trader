import type { ReactNode } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { moveSymbol } from '../lib/reorder';

interface Row {
  symbol: string;
}

/**
 * A list of symbol rows. Outside edit mode it is a plain list in server order;
 * in edit mode every row gets a drag handle (mouse, touch after a short hold,
 * or keyboard). `onReorder` receives the whole new sequence.
 */
export function ReorderableList<T extends Row>({
  rows,
  editing,
  testIdPrefix,
  onReorder,
  renderRow,
}: {
  rows: T[];
  editing: boolean;
  testIdPrefix: string;
  onReorder: (next: T[]) => void;
  renderRow: (row: T) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const next = moveSymbol(rows, String(active.id), String(over.id));
    if (next !== rows) onReorder(next);
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={rows.map((r) => r.symbol)} strategy={verticalListSortingStrategy}>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <SortableRow key={row.symbol} id={row.symbol} editing={editing} testId={`${testIdPrefix}-${row.symbol}`}>
              {renderRow(row)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableRow({
  id,
  editing,
  testId,
  children,
}: {
  id: string;
  editing: boolean;
  testId: string;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !editing });
  return (
    <li
      ref={setNodeRef}
      data-testid={testId}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`relative flex items-center gap-3 px-3 py-2.5 ${isDragging ? 'z-10 bg-surface-1 shadow-lg' : ''}`}
    >
      {editing && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${id}`}
          style={{ touchAction: 'none' }}
          className="-ml-1 shrink-0 cursor-grab select-none px-1.5 py-1 text-lg leading-none text-muted"
        >
          ≡
        </button>
      )}
      {children}
    </li>
  );
}
