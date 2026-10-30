import type { Material } from "@/lib/materials";

export function MaterialTable({
  materials,
  onSelect,
}: {
  materials: Material[];
  onSelect: (material: Material) => void;
}) {
  return (
    <div className="overflow-x-auto">
      {/* On small screens the Edit column is hidden; tapping a row opens
          the material. Prices are not part of the material master. */}
      <table className="w-full text-left">
        <thead className="bg-canvas/60 text-xs tracking-wide text-ink-muted uppercase">
          <tr>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Material Number
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              Description
            </th>
            <th scope="col" className="hidden px-4 py-2.5 sm:table-cell">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {materials.map((material) => (
            <tr
              key={material.materialNumber}
              onClick={() => onSelect(material)}
              className="cursor-pointer hover:bg-brand-soft/50"
            >
              <td className="px-4 py-3 font-mono font-medium text-brand-strong">
                {material.materialNumber}
              </td>
              <td className="px-4 py-3">{material.description}</td>
              <td className="hidden px-4 py-3 text-right sm:table-cell">
                {/* The button makes editing reachable by keyboard */}
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(material);
                  }}
                  className="rounded-md px-2 py-1 font-medium text-brand hover:bg-brand-soft"
                >
                  Edit<span className="sr-only"> {material.materialNumber}</span>
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
