"use client";

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  maxAmount?: number;
  decimals?: number;
  label: string;
  symbol?: string;
  disabled?: boolean;
}

export function AmountInput({
  value,
  onChange,
  maxAmount,
  decimals = 6,
  label,
  symbol,
  disabled,
}: AmountInputProps) {
  const handleMax = () => {
    if (maxAmount !== undefined) {
      const val = maxAmount / Math.pow(10, decimals);
      onChange(val.toString());
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm text-[var(--color-text-secondary)]">
          {label}
        </label>
        {maxAmount !== undefined && (
          <button
            type="button"
            onClick={handleMax}
            disabled={disabled}
            className="text-xs text-[var(--color-accent)] hover:underline disabled:opacity-50"
          >
            Max: {(maxAmount / Math.pow(10, decimals)).toFixed(2)} {symbol}
          </button>
        )}
      </div>
      <div className="flex items-center rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] focus-within:border-[var(--color-accent)]">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0.00"
          disabled={disabled}
          step={1 / Math.pow(10, decimals)}
          min="0"
          className="flex-1 bg-transparent px-4 py-3 text-lg outline-none text-[var(--color-text-primary)] placeholder-[var(--color-text-muted)] disabled:opacity-50 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        {symbol && (
          <span className="pr-4 text-sm text-[var(--color-text-secondary)]">
            {symbol}
          </span>
        )}
      </div>
    </div>
  );
}
