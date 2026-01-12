import numpy as np
from stl import mesh

# STL 파일 불러오기
model = mesh.Mesh.from_file('./finger_simple_l/meshes/Link_3.STL')

# Y축 반전 (XZ 평면 기준 미러링)
model.vectors[:, :, 1] *= -1
model.update_normals()

# 저장
model.save('./finger_simple_l/meshes/Link_3.STL')
