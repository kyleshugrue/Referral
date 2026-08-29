import React from 'react';
import { SynergyButton } from '@/components/ui/synergy-button';

export default function SynergyButtonDemoPage() {
  return (
    <div className="container mx-auto py-12">
      <h1 className="text-3xl font-bold mb-8">Synergy AI Button Patterns</h1>
      
      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-4">Default Style</h2>
          <div className="space-y-4">
            <div>
              <SynergyButton iconPosition="left">Synergy AI</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Default button with icon on left</p>
            </div>
            
            <div>
              <SynergyButton iconPosition="right">Synergy AI</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Default button with icon on right</p>
            </div>
            
            <div>
              <SynergyButton iconPosition="none">Without Icon</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Default button without icon</p>
            </div>
            
            <div>
              <SynergyButton fullWidth>Full Width Button</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Full width default button</p>
            </div>
          </div>
        </section>
        
        <section>
          <h2 className="text-xl font-semibold mb-4">Subtle Style</h2>
          <div className="space-y-4">
            <div>
              <SynergyButton variant="subtle" iconPosition="left">Synergy AI</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Subtle button with icon on left</p>
            </div>
            
            <div>
              <SynergyButton variant="subtle" iconPosition="right">Synergy AI</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Subtle button with icon on right</p>
            </div>
            
            <div>
              <SynergyButton variant="subtle" iconPosition="none">Without Icon</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Subtle button without icon</p>
            </div>
            
            <div>
              <SynergyButton variant="subtle" fullWidth>Full Width Button</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Full width subtle button</p>
            </div>
          </div>
        </section>
        
        <section>
          <h2 className="text-xl font-semibold mb-4">Complex Style</h2>
          <div className="space-y-4">
            <div>
              <SynergyButton variant="complex" iconPosition="left">Synergy AI</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Complex button with icon on left</p>
            </div>
            
            <div>
              <SynergyButton variant="complex" iconPosition="right">Synergy AI</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Complex button with icon on right</p>
            </div>
            
            <div>
              <SynergyButton variant="complex" iconPosition="none">Without Icon</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Complex button without icon</p>
            </div>
            
            <div>
              <SynergyButton variant="complex" fullWidth>Full Width Button</SynergyButton>
              <p className="mt-2 text-sm text-gray-500">Full width complex button</p>
            </div>
          </div>
        </section>
        
        <section>
          <h2 className="text-xl font-semibold mb-4">Size Variants</h2>
          <div className="flex flex-wrap items-center gap-4">
            <SynergyButton size="sm" variant="complex">Small</SynergyButton>
            <SynergyButton size="default" variant="complex">Default</SynergyButton>
            <SynergyButton size="lg" variant="complex">Large</SynergyButton>
          </div>
        </section>
      </div>
    </div>
  );
}