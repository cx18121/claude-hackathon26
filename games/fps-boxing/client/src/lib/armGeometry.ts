import * as THREE from 'three';

/**
 * Build a reusable arm segment mesh (upper arm or forearm).
 *
 * The geometry is a CylinderGeometry with length=1.0. The actual length is
 * set per-frame via mesh.scale.y in updateArmSegment — no geometry rebuild needed.
 *
 * @param radiusTop - radius at the top end (shoulder or elbow end)
 * @param radiusBottom - radius at the bottom end (elbow or wrist end)
 * @param mat - material to apply (MeshToonMaterial or any THREE.Material)
 */
export function buildArmSegment(
  radiusTop: number,
  radiusBottom: number,
  mat: THREE.Material,
): THREE.Mesh {
  // length=1.0 is the canonical unit; actual length set via mesh.scale.y each frame
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, 1.0, 8, 1);
  return new THREE.Mesh(geo, mat);
}

/**
 * Update an arm segment mesh to span from `from` to `to` without rebuilding geometry.
 *
 * CylinderGeometry extends along Y. lookAt() orients Z toward target. rotateX(PI/2)
 * corrects Y→direction alignment. See RESEARCH.md Pitfall 4.
 *
 * T-14-01-03: Guards against NaN/Infinity keypoints from ML failures — returns early
 * without updating the mesh if either endpoint contains non-finite values.
 *
 * @param mesh - arm segment mesh built with buildArmSegment
 * @param from - world-space start position (shoulder or elbow)
 * @param to - world-space end position (elbow or wrist)
 */
export function updateArmSegment(
  mesh: THREE.Mesh,
  from: THREE.Vector3,
  to: THREE.Vector3,
): void {
  // T-14-01-03: prevent WebGL NaN corruption from ML failures
  if (
    !isFinite(from.x) || !isFinite(from.y) || !isFinite(from.z) ||
    !isFinite(to.x)   || !isFinite(to.y)   || !isFinite(to.z)
  ) {
    return;
  }

  const mid = from.clone().add(to).multiplyScalar(0.5);
  mesh.position.copy(mid);
  mesh.scale.y = from.distanceTo(to);
  mesh.lookAt(to);
  mesh.rotateX(Math.PI / 2);
}
