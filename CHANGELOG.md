# Changelog

## 1.0.0

- Catmull-Clark subdivision with viewport and export levels, semi-sharp edge creases, Smooth by Angle
  and Mark Sharp shading, as a non-destructive modifier stack per mesh.
- Live viewport display that follows edits, undo, textures, view modes, face highlight and armature
  animation. The mesh itself stays the pickable cage.
- Exports (OBJ, FBX, Collada, glTF/GLB including skinned, STL) contain the subdivided mesh. The
  `.bbmodel` keeps the cage, also when saved during an export.
- Apply: make the subdivision permanent, keeping UVs, textures, bone weights, seams and marks.
- Panel, mesh context menu actions, two settings, and the `window.BlockSmooth` API.
