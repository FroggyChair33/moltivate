import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from moltivate_motion import SIZE, analyze, decoder_command, probe_video


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg required for media tests")
class MediaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.video = self.root / "fixture.mov"
        self.make_video(self.video)

    def tearDown(self):
        self.temp.cleanup()

    def make_video(self, path, seconds=.2):
        subprocess.run(["ffmpeg","-nostdin","-v","error","-f","lavfi","-i","color=c=red:s=192x96:r=10",
                        "-t",str(seconds),"-c:v","libx264","-threads","1","-pix_fmt","yuv420p",str(path)],
                       check=True,capture_output=True,timeout=15)

    def test_mov_dimensions_and_duration(self):
        r=probe_video(self.video)
        self.assertEqual((r["source_width"],r["source_height"]),(192,96))
        self.assertAlmostEqual(r["duration_seconds"],.2)

    def test_rotation_metadata_is_applied_without_stretching(self):
        rotated=self.root/"rotated.mov"
        subprocess.run(["ffmpeg","-nostdin","-v","error","-display_rotation:v:0","90",
                        "-i",str(self.video),"-c","copy",str(rotated)],check=True,capture_output=True,timeout=15)
        plain=subprocess.run(decoder_command(self.video),check=True,capture_output=True,timeout=15).stdout
        turned=subprocess.run(decoder_command(rotated),check=True,capture_output=True,timeout=15).stdout
        self.assertEqual(len(plain),2*SIZE*SIZE*3)
        self.assertEqual(len(turned),len(plain))
        def red(data,x,y):return data[(y*SIZE+x)*3]
        self.assertGreater(red(plain,20,320),200)
        self.assertLess(red(plain,320,20),10)
        self.assertLess(red(turned,20,320),10)
        self.assertGreater(red(turned,320,20),200)

    def test_empty_and_nonvideo_input_rejected(self):
        empty=self.root/"empty.mov";empty.touch()
        with self.assertRaises(ValueError):probe_video(empty)
        wrong=self.root/"wrong.mov";wrong.write_text("not a movie")
        with self.assertRaises(subprocess.CalledProcessError):probe_video(wrong)

    def test_hevc_mov_decodes(self):
        encoders=subprocess.run(["ffmpeg","-hide_banner","-encoders"],capture_output=True,text=True,check=True).stdout
        if "libx265" not in encoders:
            self.skipTest("HEVC fixture encoder unavailable")
        hevc=self.root/"hevc.mov"
        subprocess.run(["ffmpeg","-nostdin","-v","error","-i",str(self.video),"-c:v","libx265",
                        "-x265-params","pools=1:frame-threads=1:log-level=error","-tag:v","hvc1",str(hevc)],
                        check=True,capture_output=True,timeout=15)
        data=subprocess.run(decoder_command(hevc),capture_output=True,check=True,timeout=15).stdout
        self.assertEqual(len(data),2*SIZE*SIZE*3)

    def test_overlong_clip_is_rejected(self):
        long=self.root/"long.mov";self.make_video(long,61)
        with self.assertRaises(ValueError):probe_video(long)

    def test_existing_results_are_never_overwritten(self):
        model=self.root/"model.task";model.write_bytes(b"placeholder")
        args=argparse.Namespace(video=str(self.video),model=str(model),output_dir=str(self.root),
                                exercise="squats",side="auto",overlay=False)
        with self.assertRaises(FileExistsError):analyze(args)


if __name__=="__main__":
    unittest.main()
