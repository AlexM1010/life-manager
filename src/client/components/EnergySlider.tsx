/**
 * EnergySlider Component
 * 
 * A reusable slider input for selecting energy level from 0 to 10.
 * Used in the Today Plan view to set energy level before generating a plan.
 * 
 * Features:
 * - Clean, accessible slider with native HTML range input
 * - Shows current value prominently
 * - Visual feedback with color gradient based on energy level
 * - Keyboard accessible (arrow keys to adjust)
 * 
 * Requirements: 4.4
 */

interface EnergySliderProps {
  /** Current energy level (0-10) */
  value: number;
  /** Callback when energy level changes */
  onChange: (value: number) => void;
  /** Optional label text (defaults to "Energy Level") */
  label?: string;
  /** Optional additional CSS classes */
  className?: string;
}

export function EnergySlider({
  value,
  onChange,
  label = 'Energy Level',
  className = '',
}: EnergySliderProps) {
  // Determine color based on energy level
  const getEnergyColor = (level: number): string => {
    if (level <= 3) return 'text-red-600';
    if (level <= 6) return 'text-yellow-600';
    return 'text-green-600';
  };

  // Determine energy description
  const getEnergyDescription = (level: number): string => {
    if (level === 0) return 'Exhausted';
    if (level <= 2) return 'Very Low';
    if (level <= 4) return 'Low';
    if (level <= 6) return 'Moderate';
    if (level <= 8) return 'Good';
    if (level === 9) return 'Great';
    return 'Excellent';
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseInt(e.target.value, 10));
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Label and Value Display */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="energy-slider"
          className="text-sm font-medium text-foreground"
        >
          {label}
        </label>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${getEnergyColor(value)}`}>
            {value}
          </span>
          <span className="text-sm text-muted-foreground">/ 10</span>
        </div>
      </div>

      {/* Slider */}
      <div className="relative">
        <input
          id="energy-slider"
          type="range"
          min="0"
          max="10"
          step="1"
          value={value}
          onChange={handleChange}
          className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer
                     focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2
                     [&::-webkit-slider-thumb]:appearance-none
                     [&::-webkit-slider-thumb]:w-5
                     [&::-webkit-slider-thumb]:h-5
                     [&::-webkit-slider-thumb]:rounded-full
                     [&::-webkit-slider-thumb]:bg-primary
                     [&::-webkit-slider-thumb]:cursor-pointer
                     [&::-webkit-slider-thumb]:transition-transform
                     [&::-webkit-slider-thumb]:hover:scale-110
                     [&::-moz-range-thumb]:w-5
                     [&::-moz-range-thumb]:h-5
                     [&::-moz-range-thumb]:rounded-full
                     [&::-moz-range-thumb]:bg-primary
                     [&::-moz-range-thumb]:border-0
                     [&::-moz-range-thumb]:cursor-pointer
                     [&::-moz-range-thumb]:transition-transform
                     [&::-moz-range-thumb]:hover:scale-110"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={10}
          aria-valuenow={value}
          aria-valuetext={`${value} out of 10, ${getEnergyDescription(value)}`}
        />
        
        {/* Tick marks */}
        <div className="flex justify-between mt-1 px-0.5">
          {Array.from({ length: 11 }, (_, i) => (
            <span
              key={i}
              className="text-xs text-muted-foreground"
              style={{ width: '1ch', textAlign: 'center' }}
            >
              {i}
            </span>
          ))}
        </div>
      </div>

      {/* Energy Description */}
      <div className="text-center">
        <span className={`text-sm font-medium ${getEnergyColor(value)}`}>
          {getEnergyDescription(value)}
        </span>
      </div>
    </div>
  );
}
