"""Synthetic landmark/sequence tests, NOT a validation dataset of real workouts."""
import copy
import math
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from motion_core import CycleCounter, EXERCISES, MotionSession, Pose, angle, extract


def fixture(exercise="squats", active=False, yaw=0, mirror=False):
    q = [(0, .2, 0) for _ in range(33)]
    for side, ids in ((-1, (11,13,15,23,25,27)), (1,(12,14,16,24,26,28))):
        s,e,w,h,k,a = ids
        x = .18 * side
        if exercise in ("squats", "jumping_jacks"):
            q[s], q[e], q[w] = (side*.2,.3,0), (side*.2,.6,0), (side*.2,.9,0)
            q[h], q[k], q[a] = (x,.9,0), (x,1.35,0), (x,1.8,0)
            if active and exercise == "squats":
                q[s], q[h], q[k], q[a] = (side*.2,.75,0), (x,1.35,0), (x,1.35,-.45), (x,1.8,-.45)
            elif active:
                q[e], q[w] = (side*.5,0,0), (side*.8,-.3,0)
                q[k], q[a] = (side*.45,1.3,0), (side*.75,1.7,0)
        elif exercise == "pushups":
            z = side*.15
            q[s], q[h], q[k], q[a] = (-.7,.9,z), (0,.9,z), (.45,.9,z), (.9,.9,z)
            q[e], q[w] = ((-.45,1.1,z),(-.7,1.3,z)) if active else ((-.7,1.2,z),(-.7,1.5,z))
        elif exercise == "situps":
            z = side*.15
            q[s] = (-.12,.81,z) if active else (-.6,1.4,z)
            q[h], q[k], q[a] = (0,1.4,z), (.35,1.1,z), (.7,1.4,z)
            q[e], q[w] = (-.2,1,z), (-.2,1.2,z)
    theta = math.radians(yaw)
    q = [(x*math.cos(theta)+z*math.sin(theta),y,-x*math.sin(theta)+z*math.cos(theta)) for x,y,z in q]
    if mirror:
        q = [(-x,y,z) for x,y,z in q]
    image = [(.5+.25*x,.15+.3*y,z) for x,y,z in q]
    return Pose(image,q,[.95]*33,[.95]*33)


def run_states(states, step=.1, times=None):
    counter = CycleCounter()
    for i, state in enumerate(states):
        counter.update(times[i] if times else i*step, state)
    return counter.result()


class GeometryTests(unittest.TestCase):
    def test_three_dimensional_angle_is_rotation_invariant(self):
        a,b,c = (1,2,3), (0,0,0), (-2,3,.5)
        expected = angle(a,b,c)
        for yaw in range(0,360,15):
            t=math.radians(yaw)
            rotated=[(x*math.cos(t)+z*math.sin(t),y,-x*math.sin(t)+z*math.cos(t)) for x,y,z in (a,b,c)]
            self.assertAlmostEqual(angle(*rotated),expected)

    def test_degenerate_vectors_rejected(self):
        with self.assertRaises(ValueError):
            angle((0,0,0),(0,0,0),(1,0,0))

    def test_all_exercise_endpoints_and_mirroring(self):
        for exercise in EXERCISES:
            for active in (False,True):
                for mirror in (False,True):
                    with self.subTest(exercise=exercise,active=active,mirror=mirror):
                        f=extract(fixture(exercise,active,mirror=mirror),exercise)
                        self.assertEqual(f.state,"active" if active else "neutral", f)

    def test_yaw_views_when_joints_remain_observable(self):
        for exercise in EXERCISES:
            for yaw in (-60,-30,0,30,60):
                for active in (False,True):
                    with self.subTest(exercise=exercise,yaw=yaw,active=active):
                        f=extract(fixture(exercise,active,yaw),exercise)
                        self.assertEqual(f.state,"active" if active else "neutral",f)

    def test_end_on_pushup_is_rejected_when_torso_collapses(self):
        self.assertEqual(extract(fixture("pushups",yaw=90),"pushups").reason,"torso_foreshortened")

    def test_standing_elbow_bends_are_not_pushups(self):
        self.assertEqual(extract(fixture(),"pushups").reason,"pushup_posture_not_visible")

    def test_standing_squats_are_not_situps(self):
        for active in (False,True):
            self.assertEqual(extract(fixture(active=active),"situps").state,None)

    def test_jacks_need_arms_and_feet(self):
        neutral, opened = fixture("jumping_jacks"), fixture("jumping_jacks",True)
        for ids in ((11,12,13,14,15,16),(23,24,25,26,27,28)):
            p=copy.deepcopy(neutral)
            for i in ids:
                p.world[i],p.image[i]=opened.world[i],opened.image[i]
            self.assertNotEqual(extract(p,"jumping_jacks").state,"active")

    def test_low_presence_not_just_visibility(self):
        p=fixture();p.presence[25]=.1
        self.assertEqual(extract(p,"squats").reason,"low_landmark_confidence")

    def test_missing_nonfinite_and_cropped_landmarks(self):
        for kind in ("missing","nan","cropped"):
            p=fixture()
            if kind=="missing":p.world=[]
            if kind=="nan":p.world[25]=(float("nan"),0,0)
            if kind=="cropped":p.image[25]=(1.1,.5,0)
            self.assertIsNone(extract(p,"squats").state)


class CounterTests(unittest.TestCase):
    def test_complete_cycle(self):
        r=run_states(["neutral"]*4+["middle"]*2+["active"]*4+["middle"]*2+["neutral"]*4)
        self.assertEqual((r["complete_cycles"],r["initial_partial_cycles"]),(1,0))

    def test_initial_partial_not_full_credit(self):
        r=run_states(["middle"]*2+["active"]*4+["middle"]*2+["neutral"]*4)
        self.assertEqual((r["complete_cycles"],r["initial_partial_cycles"]),(0,1))

    def test_standing_and_short_endpoint_jitter(self):
        for states in (["neutral"]*100, ["neutral"]*4+["active"]+["neutral"]*10):
            self.assertEqual(run_states(states)["complete_cycles"],0)

    def test_missing_frame_resets_incomplete_rep(self):
        r=run_states(["neutral"]*4+["active"]*4+[None]+["active"]*3+["neutral"]*4)
        self.assertEqual((r["complete_cycles"],r["initial_partial_cycles"]),(0,0))

    def test_time_gap_cannot_bridge_a_rep(self):
        r=run_states(["neutral"]*4+["active"]*4+["neutral"]*4,
                     times=[i*.1 for i in range(8)]+[4+i*.1 for i in range(4)])
        self.assertEqual(r["complete_cycles"],0)

    def test_hold_does_not_repeat_count_and_unfinished_is_flagged(self):
        r=run_states(["neutral"]*4+["active"]*40+["neutral"]*10)
        self.assertEqual(r["complete_cycles"],1)
        self.assertTrue(run_states(["neutral"]*4+["active"]*5)["unfinished_cycle"])

    def test_stale_cycle_rejected(self):
        r=run_states(["neutral"]*4+["active"]*150+["neutral"]*4)
        self.assertEqual(r["complete_cycles"],0)

    def test_invalid_timestamps_rejected(self):
        for t in (0,-1,float("nan")):
            c=CycleCounter();c.update(0,"neutral")
            with self.assertRaises(ValueError):c.update(t,"neutral")

    def test_user_supplied_v02_angle_trace_regression(self):
        # Rounded 2D diagnostic provided in chat. Does NOT validate 3D inference.
        trace=[146.3,132.8,117.2,99.2,97.2,120.4,143,160.4,176,175.5,176.2,172.2,162.1,153.6,142.5,130.9,118,106,93.4,93.6,120.1,138.7,157.4,171.4,176.9,177.7,177.5,174.7,166.5,153.8,142.4,130.6,118.7,109.1,101.1,103.4,119.7,141.9,157.2,169.3,177.4,178.6,178.4,169.6,155.8,145.3,136.3,123,110.4,103.3,100.8,115.2,135.5,154.7,169.9,177.6]
        r=run_states(["neutral" if a>=160 else "active" if a<=110 else "middle" for a in trace],.2)
        self.assertEqual((r["complete_cycles"],r["initial_partial_cycles"]),(3,1))


class SessionTests(unittest.TestCase):
    def test_all_exercises_count_two_cycles(self):
        for exercise in EXERCISES:
            s=MotionSession(exercise)
            for i, active in enumerate([False]*5+[True]*5+[False]*5+[True]*5+[False]*5):
                s.update(i*.1,[fixture(exercise,active)])
            r=s.result()
            self.assertEqual(r["complete_cycles"],2,exercise)
            self.assertFalse(r["payout_eligible"])
            self.assertFalse(r["form_assessed"])

    def test_auto_selects_visible_right_side(self):
        s=MotionSession("squats")
        for i, active in enumerate([False]*5+[True]*5+[False]*5):
            p=fixture(active=active);p.visibility[25]=.1
            s.update(i*.1,[p])
        self.assertEqual(s.result()["side_frame_counts"],{"right":15})
        self.assertEqual(s.result()["complete_cycles"],1)

    def test_side_locked_when_confidence_fluctuates(self):
        s=MotionSession("squats")
        for i, active in enumerate([False]*5+[True]*5+[False]*5):
            p=fixture(active=active)
            p.visibility[25]=.8 if i>4 else .99
            p.presence[25]=.99
            s.update(i*.1,[p])
        self.assertEqual(len(s.result()["side_acquisitions"]),1)

    def test_side_loss_requires_fresh_neutral_before_counting(self):
        s=MotionSession("squats")
        for i, active in enumerate([False]*5+[True]*12+[False]*5):
            p=fixture(active=active)
            if i>=9:p.visibility[25]=.1
            s.update(i*.1,[p])
        r=s.result()
        self.assertEqual(r["complete_cycles"],0)
        self.assertEqual([e["side"] for e in r["side_acquisitions"]],["left","right"])

    def test_no_pose_and_multiple_people_are_explicit(self):
        s=MotionSession("squats")
        for i in range(10):s.update(i*.1,[])
        s.update(1.0,[fixture(),fixture()])
        r=s.result()
        self.assertEqual(r["status"],"needs_retry")
        self.assertEqual(r["rejected_frame_reasons"]["no_person_detected"],10)
        self.assertIn("multiple_people_in_clip",r["retry_reasons"])

    def test_low_coverage_is_not_success(self):
        s=MotionSession("squats")
        for i in range(30):s.update(i*.1,[fixture()] if i<10 else [])
        self.assertEqual(s.result()["status"],"needs_retry")

    def test_standing_negative_control(self):
        s=MotionSession("squats")
        for i in range(20):s.update(i*.1,[fixture()])
        self.assertEqual(s.result()["complete_cycles"],0)
        self.assertEqual(s.result()["status"],"experimental_only")


if __name__=="__main__":
    unittest.main()
