from __future__ import annotations
from dataclasses import dataclass
import math

@dataclass
class CycleSettings:
    start_x: float = 0.28
    start_y: float = -0.23
    home_height: float = 0.8
    lower_height: float = 0.2
    move_speed: float = 0.12
    z_load_threshold: float = 10.0
    contact_hold_time: float = 0.02
    open_duration: float = 1.8
    close_duration: float = 1.8
    release_duration: float = 0.5
    release_x: float = 0.0
    release_y: float = 0.0
    open_angle: float = 0.65
    closed_angle: float = 0.0

    def validate(self):
        bounds = {'start_x': (-0.33, 0.33), 'start_y': (-0.27, 0.27), 'home_height': (0.65, 0.95), 'lower_height': (0.2, 0.75), 'move_speed': (0.01, 0.14), 'z_load_threshold': (0.1, 30.0), 'contact_hold_time': (0.0, 0.2), 'open_duration': (0.0, 10.0), 'close_duration': (0.2, 5.0), 'release_duration': (0.0, 3.0), 'release_x': (-0.33, 0.33), 'release_y': (-0.27, 0.27), 'open_angle': (0.0, 0.8), 'closed_angle': (0.0, 0.8)}
        for name, (lo, hi) in bounds.items():
            value = getattr(self, name)
            if not math.isfinite(value) or not lo <= value <= hi:
                raise ValueError(f'{name}: {lo} ~ {hi}')
        if self.lower_height >= self.home_height:
            raise ValueError('하강 한계는 시작 높이보다 낮아야 합니다.')
        if self.closed_angle >= self.open_angle:
            raise ValueError('닫힘 각도는 벌림 각도보다 작아야 합니다.')