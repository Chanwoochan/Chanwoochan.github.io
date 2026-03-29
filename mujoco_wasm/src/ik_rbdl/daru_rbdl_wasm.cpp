#include <algorithm>
#include <cmath>
#include <memory>
#include <Eigen/Geometry>
#include "daru_v4_rbdl.hpp"

using namespace RigidBodyDynamics;
using namespace RigidBodyDynamics::Math;

namespace {
std::unique_ptr<DARU_RBDL> g_daru;
VectorNd g_ref_pos = VectorNd::Zero(15);

constexpr double PI = 3.14159265358979323846;

inline double clipAbs(double value, double limit) {
  return std::max(-limit, std::min(limit, value));
}

Eigen::Quaterniond quatWxyz(const double* q) {
  return Eigen::Quaterniond(q[0], q[1], q[2], q[3]);
}

void applyJointLimits(VectorNd& q) {
  q[0] = std::clamp(q[0], -3.14, 3.14);
  q[1] = std::clamp(q[1], -4.460, 0.8378);
  q[2] = std::clamp(q[2], -0.349, 3.491);
  q[3] = std::clamp(q[3], -2.88, 2.88);
  q[4] = std::clamp(q[4], -2.356, 0.0);
  q[5] = std::clamp(q[5], -1.571, 1.571);
  q[6] = std::clamp(q[6], -1.571, 1.571);
  q[7] = std::clamp(q[7], -1.571, 1.571);

  q[8] = std::clamp(q[8], -4.460, 0.8378);
  q[9] = std::clamp(q[9], -3.491, 0.349);
  q[10] = std::clamp(q[10], -2.88, 2.88);
  q[11] = std::clamp(q[11], -2.356, 0.0);
  q[12] = std::clamp(q[12], -1.571, 1.571);
  q[13] = std::clamp(q[13], -1.571, 1.571);
  q[14] = std::clamp(q[14], -1.571, 1.571);
}
}

extern "C" {

int daru_ik_init(const char* urdf_path) {
  try {
    g_daru = std::make_unique<DARU_RBDL>(urdf_path);
  } catch (...) {
    g_daru.reset();
    return 0;
  }
  if (!g_daru || g_daru->Dof() != 15) {
    g_daru.reset();
    return 0;
  }
  g_ref_pos = VectorNd::Zero(15);
  return 1;
}

int daru_ik_init_from_xml(const char* urdf_xml) {
  if (!urdf_xml) {
    return 0;
  }
  try {
    g_daru = std::make_unique<DARU_RBDL>(std::string(urdf_xml), true);
  } catch (...) {
    g_daru.reset();
    return 0;
  }
  g_ref_pos = VectorNd::Zero(15);
  if (!g_daru || g_daru->Dof() != 15) {
    g_daru.reset();
    return 0;
  }
  return 1;
}

void daru_ik_reset_ref(const double* q15) {
  if (!g_daru || !q15) {
    return;
  }
  for (int i = 0; i < 15; ++i) {
    g_ref_pos[i] = q15[i];
  }
}

int daru_cg_from_state(const double* q15, const double* qdot15, double* cg15_out) {
  if (!g_daru || !q15 || !qdot15 || !cg15_out) {
    return 0;
  }

  JOINT_ joints[15]{};
  for (int i = 0; i < 15; ++i) {
    joints[i].A_pos = q15[i];
    joints[i].A_vel = qdot15[i];
  }

  VectorNd cg = VectorNd::Zero(15);
  g_daru->updateQ(joints);
  g_daru->calCG(cg);

  for (int i = 0; i < 15; ++i) {
    cg15_out[i] = cg[i];
  }

  return 1;
}

int daru_ik_step(
    const double* q15,
    const double* l_pos_des,
    const double* r_pos_des,
    const double* l_quat_des_wxyz,
    const double* r_quat_des_wxyz,
    double* q15_out) {
  if (!g_daru || !q15 || !l_pos_des || !r_pos_des || !l_quat_des_wxyz || !r_quat_des_wxyz || !q15_out) {
    return 0;
  }

  for (int i = 0; i < 15; ++i) {
    g_ref_pos[i] = q15[i];
  }

  Vector3d l_pos_act = Vector3d::Zero();
  Vector3d r_pos_act = Vector3d::Zero();
  Matrix3d l_rot_act = Matrix3d::Identity();
  Matrix3d r_rot_act = Matrix3d::Identity();
  g_daru->calEEPosq(l_pos_act, l_rot_act, r_pos_act, r_rot_act, g_ref_pos);

  Eigen::Quaterniond lq_des = quatWxyz(l_quat_des_wxyz);
  Eigen::Quaterniond rq_des = quatWxyz(r_quat_des_wxyz);

  Matrix3d l_rot_des = lq_des.toRotationMatrix();
  Matrix3d r_rot_des = rq_des.toRotationMatrix();

  Vector3d l_pos_e(l_pos_des[0], l_pos_des[1], l_pos_des[2]);
  Vector3d r_pos_e(r_pos_des[0], r_pos_des[1], r_pos_des[2]);
  l_pos_e -= l_pos_act;
  r_pos_e -= r_pos_act;

  Matrix3d l_rot_e = l_rot_des.transpose() * l_rot_act;
  Matrix3d r_rot_e = r_rot_des.transpose() * r_rot_act;

  Vector3d phi_l = Vector3d::Zero();
  Vector3d phi_r = Vector3d::Zero();
  g_daru->Log(l_rot_e, phi_l);
  g_daru->Log(r_rot_e, phi_r);

  VectorNd X = VectorNd::Zero(12);
  VectorNd X_null = VectorNd::Zero(12);
  VectorNd Q = VectorNd::Zero(15);
  VectorNd Q_null = VectorNd::Zero(15);

  X << 0 * phi_l,
       1 * l_pos_e,
       0 * phi_r,
       1 * r_pos_e;

  X_null << 1 * phi_l,
            0 * l_pos_e,
            1 * phi_r,
            0 * r_pos_e;

  for (int i = 0; i < 12; ++i) {
    if (i == 3 || i == 4 || i == 5 || i == 9 || i == 10 || i == 11) {
      X[i] = clipAbs(X[i], 0.01);
      X_null[i] = clipAbs(X_null[i], 0.003);
    } else {
      X[i] = clipAbs(X[i], PI * 0.005);
      X_null[i] = clipAbs(X_null[i], PI * 0.01);
    }
  }

  MatrixNd N = MatrixNd::Zero(15, 15);
  g_daru->calJqWaist(g_ref_pos);
  g_daru->calIK(X, Q);
  g_daru->calIK(X_null, Q_null);
  g_daru->calJqWaistPos(g_ref_pos);
  g_daru->calNullSpace(N);

  Q_null(0) += 0.01 * (0 - g_ref_pos(0));
  Q_null(2) += 0.05 * (PI / 12 - g_ref_pos(2));
  Q_null(9) += 0.05 * (-PI / 12 - g_ref_pos(9));

  Q = Q + N * Q_null;
  g_ref_pos += Q;
  applyJointLimits(g_ref_pos);

  for (int i = 0; i < 15; ++i) {
    q15_out[i] = g_ref_pos[i];
  }

  return 1;
}

}  // extern "C"
