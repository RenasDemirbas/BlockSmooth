# Changelog

## 1.1.0 — Fewer vertices

- The viewport draws shared vertices: about one GPU vertex per surface point instead of four per
  quad. That is 2.6× fewer at level 2 and 3.2× fewer at level 3, with identical pixels, and vertex
  drags get slightly faster. A vertex is shared within one cage face and normal fan. If an armature
  bend turns a smooth-by-angle edge sharp, the sharing is rebuilt for that frame.
- glTF / GLB exports are welded: bit-identical vertices are merged, and the triangles are unchanged
  (12 096 → 4 584 vertices on a 24-part character). The welded copy exists only while the exporter
  reads the scene, so nothing else in Blockbench sees it. Meshes inside an armature stay skinned and
  unwelded, the way Blockbench writes them.
- Unit tests for vertex sharing and welding. The live checks in Blockbench MCP now cover skinned
  meshes: deformation, re-sharing, and glTF with and without the armature option.

## 1.0.0

- Catmull-Clark subdivision with viewport and export levels, semi-sharp edge creases, Smooth by Angle
  and Mark Sharp shading, as a non-destructive modifier stack per mesh.
- Live viewport display that follows edits, undo, textures, view modes, face highlight and armature
  animation. The mesh itself stays the pickable cage.
- Exports (OBJ, FBX, Collada, glTF/GLB including skinned, STL) contain the subdivided mesh. The
  `.bbmodel` keeps the cage, also when saved during an export.
- Apply: make the subdivision permanent, keeping UVs, textures, bone weights, seams and marks.
- Panel, mesh context menu actions, two settings, and the `window.BlockSmooth` API.
