import copy
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from calibration import squat_reference
from motion_core import MotionSession
from test_motion import fixture


def reference_rows():
    return [{"seconds": i/10, "side":"left", "state":"middle", "reason":None,
             "confidence":.95, "knee_degrees":157 + (i%2)} for i in range(7)]


class CalibrationTests(unittest.TestCase):
    def test_reference_estimates_threshold_with_fixed_margin(self):
        result=squat_reference(reference_rows(),0,.6)
        self.assertEqual(result["knee_extended_min"],152)
        self.assertFalse(result["standing_pose_verified"])

    def test_outside_motion_does_not_change_calibration(self):
        rows=reference_rows()
        outside=dict(rows[-1],seconds=2,knee_degrees=180)
        self.assertEqual(squat_reference(rows,0,.6),squat_reference(rows+[outside],0,.6))

    def test_short_outside_and_nonfinite_windows_rejected(self):
        for start,end in [(0,.2),(20,21),(-1,.5),(0,float("nan")),(0,61)]:
            with self.subTest(window=(start,end)),self.assertRaises(ValueError):
                squat_reference(reference_rows(),start,end)

    def test_cropped_missing_or_low_confidence_reference_rejected(self):
        for change in ({"reason":"joints_out_of_frame"},{"state":None},{"confidence":.2},
                       {"side":"right"},{"knee_degrees":float("nan")}):
            rows=reference_rows();rows[2].update(change)
            with self.subTest(change=change),self.assertRaises(ValueError):
                squat_reference(rows,0,.6)

    def test_bent_or_unstable_reference_rejected(self):
        for values in ([120]*7,[145,170,151,160,145,170,151]):
            rows=reference_rows()
            for row,value in zip(rows,values):row["knee_degrees"]=value
            with self.assertRaises(ValueError):squat_reference(rows,0,.6)

    def test_frame_gap_rejected(self):
        rows=reference_rows();del rows[2]
        with self.assertRaises(ValueError):squat_reference(rows,0,.6)

    def test_observed_regression_shape_and_calibrated_replay(self):
        # Synthetic 3D trajectory with top=157 degrees, not the user's raw video.
        # Initial descent + two subsequent complete repetitions.
        flags=[True]*5+[False]*7+[True]*5+[False]*7+[True]*5+[False]*7
        poses=[]
        baseline=MotionSession("squats")
        rows=[]
        for i, active in enumerate(flags):
            p=fixture(active=active)
            if not active:
                for ankle in (27,28):
                    x,y,z=p.world[ankle]
                    p.world[ankle]=(x,y,.45*math.tan(math.radians(23)))
            poses.append(p);rows.append(baseline.update(i/10,[p]))
        failed=baseline.result()
        self.assertEqual(failed["complete_cycles"],0)
        self.assertEqual(failed["status"],"needs_retry")
        self.assertIn("neutral_endpoint_not_observed",failed["retry_reasons"])
        cal=squat_reference(rows,.5,1.1)
        calibrated=MotionSession("squats",cal["side"],cal["knee_extended_min"])
        for i,p in enumerate(poses):calibrated.update(i/10,[p])
        result=calibrated.result()
        self.assertEqual((result["complete_cycles"],result["initial_partial_cycles"]),(2,1))
        self.assertEqual(result["neutral_holds_observed"],3)
        self.assertFalse(result["payout_eligible"])

    def test_calibrated_standing_does_not_invent_reps(self):
        session=MotionSession("squats",squat_standing=152)
        for i in range(30):session.update(i/10,[fixture()])
        self.assertEqual(session.result()["complete_cycles"],0)

    def test_calibration_cannot_remove_minimum_motion_gap(self):
        for threshold in (0,110,139,180,float("nan")):
            with self.assertRaises(ValueError):MotionSession("squats",squat_standing=threshold)


if __name__ == "__main__":
    unittest.main()
