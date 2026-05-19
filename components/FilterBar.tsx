"use client";

type FormatFilter = "ALL" | "IMAGE" | "VIDEO";

interface FilterBarProps {
  totalAds: number;
  selectedFormat: FormatFilter;
  onFilterFormat: (format: FormatFilter) => void;
}

export default function FilterBar({
  totalAds,
  selectedFormat,
  onFilterFormat,
}: FilterBarProps) {
  const formats: FormatFilter[] = ["ALL", "IMAGE", "VIDEO"];

  return (
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-100">
      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-900">{totalAds}</span> ads
      </p>
      <div className="flex items-center gap-1">
        {formats.map((format) => (
          <button
            key={format}
            onClick={() => onFilterFormat(format)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
              selectedFormat === format
                ? "bg-blue-600 text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {format}
          </button>
        ))}
      </div>
    </div>
  );
}
