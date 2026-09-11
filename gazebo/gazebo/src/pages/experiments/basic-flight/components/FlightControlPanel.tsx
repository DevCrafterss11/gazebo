import { Gamepad2 } from 'lucide-react';

import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { FlightControlSurface } from '../../../../components/flight/FlightControlSurface';

export function FlightControlPanel() {
  return (
    <PanelShell title="飞行控制" icon={Gamepad2} action={<span>运行模式</span>} emphasis="secondary">
      <FlightControlSurface />
    </PanelShell>
  );
}
