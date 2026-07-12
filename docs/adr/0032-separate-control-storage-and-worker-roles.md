# Separate frontend, control, storage, session, and compute roles

The web frontend is a client of the Control Plane and does not define the cluster. A persistent NAS may host the Control Plane and data storage, an everyday workstation may execute authenticated browser collection using its local session, and a GPU Device may provide model or media-processing capability. These roles may be colocated for a single-machine installation or distributed independently without changing Workflow semantics. Network reachability alone does not enroll a Device or authorize a Worker.
